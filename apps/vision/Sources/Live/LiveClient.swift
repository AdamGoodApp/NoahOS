import Foundation
import Observation

@MainActor
@Observable
final class LiveClient {
    enum Status { case idle, connecting, live, reconnecting, error }

    private(set) var status: Status = .idle
    private(set) var errorText = ""
    private(set) var role: Noahos_Sim_V1_Role = .unspecified
    private(set) var operatorId = ""
    private(set) var mode: Noahos_Sim_V1_Mode = .unspecified
    private(set) var policyName = ""
    private(set) var welcome: Noahos_Sim_V1_Welcome?

    @ObservationIgnored let frames = FrameBox()
    @ObservationIgnored private let robotId: String
    @ObservationIgnored private let settings: ServerSettings
    @ObservationIgnored private var task: URLSessionWebSocketTask?
    @ObservationIgnored private var runner: Task<Void, Never>?
    @ObservationIgnored private var wantOpen = false
    @ObservationIgnored private var seenFirstTelemetry = false
    @ObservationIgnored private var lastMode: Noahos_Sim_V1_Mode?
    @ObservationIgnored private var lastPolicy: String?

    init(robotId: String, settings: ServerSettings) {
        self.robotId = robotId
        self.settings = settings
    }

    var canControl: Bool { role == .operator && mode == .manual }

    func connect() {
        guard !wantOpen else { return }
        wantOpen = true
        status = .connecting
        errorText = ""
        runner = Task { [weak self] in await self?.run() }
    }

    func close() {
        let t = task
        shutDown()
        t?.cancel(with: .normalClosure, reason: nil)
    }

    private func shutDown() {
        wantOpen = false
        runner?.cancel()
        runner = nil
        task = nil
        status = .idle
    }

    func queueTarget(index: Int, value: Float) { frames.queue(index: index, value: value) }

    func flushTargets() {
        let p = frames.drain()
        guard !p.isEmpty else { return }
        var jt = Noahos_Sim_V1_JointTargets()
        for (index, value) in p {
            jt.jointIndex.append(UInt32(index))
            jt.target.append(value)
        }
        var m = Noahos_Sim_V1_ClientMessage()
        m.jointTargets = jt
        send(m)
    }

    func setMode(_ mode: Noahos_Sim_V1_Mode) {
        var sm = Noahos_Sim_V1_SetMode()
        sm.mode = mode
        var m = Noahos_Sim_V1_ClientMessage()
        m.setMode = sm
        send(m)
    }

    /// Resume manual hold after another user's Stop.
    func hold() { setMode(.manual) }

    /// Ask for the lock when nobody holds it.
    func takeControl() {
        var h = hello()
        h.role = .operator
        var m = Noahos_Sim_V1_ClientMessage()
        m.hello = h
        send(m)
    }

    /// Emergency stop, then leave the live view like the browser.
    func stop() {
        var m = Noahos_Sim_V1_ClientMessage()
        m.estop = Noahos_Sim_V1_EStop()
        send(m)
        // Let the frame leave before the socket closes.
        let t = task
        shutDown()
        Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            t?.cancel(with: .normalClosure, reason: nil)
        }
    }

    // MARK: - Internals

    private func hello() -> Noahos_Sim_V1_Hello {
        var h = Noahos_Sim_V1_Hello()
        h.clientID = settings.clientId
        h.role = .operator
        h.telemetryDivisor = 1
        h.pairToken = settings.pairToken
        return h
    }

    private func send(_ m: Noahos_Sim_V1_ClientMessage) {
        guard let task, let data = try? m.serializedData() else { return }
        task.send(.data(data)) { _ in }
    }

    private func socketURL() -> URL? {
        guard var comps = URLComponents(string: settings.trimmedBaseURL) else { return nil }
        comps.scheme = comps.scheme == "https" ? "wss" : "ws"
        comps.path = "/ws/robots/\(robotId)"
        comps.queryItems = [URLQueryItem(name: "client", value: settings.clientId)]
        return comps.url
    }

    private func run() async {
        let delays: [Double] = [0.5, 1, 2, 4, 4]
        var attempt = 0
        while wantOpen && !Task.isCancelled {
            guard let url = socketURL() else {
                status = .error
                errorText = "Bad server URL"
                wantOpen = false
                return
            }
            let ws = URLSession.shared.webSocketTask(with: url)
            task = ws
            seenFirstTelemetry = false
            lastMode = nil
            lastPolicy = nil
            ws.resume()
            var m = Noahos_Sim_V1_ClientMessage()
            m.hello = hello()
            send(m)
            do {
                while true {
                    let msg = try await ws.receive()
                    attempt = 0
                    if case .data(let d) = msg, let sm = try? Noahos_Sim_V1_ServerMessage(serializedBytes: d) {
                        handle(sm)
                    }
                }
            } catch {
                // fall through to reconnect handling
            }
            guard wantOpen && !Task.isCancelled else { return }
            if attempt >= delays.count {
                status = .error
                errorText = "Lost the simulation link"
                wantOpen = false
                return
            }
            status = .reconnecting
            let delay = delays[attempt]
            attempt += 1
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
        }
    }

    private func handle(_ sm: Noahos_Sim_V1_ServerMessage) {
        switch sm.msg {
        case .telemetry(let t):
            frames.store(t)
            if lastMode != t.mode || lastPolicy != t.policy {
                lastMode = t.mode
                lastPolicy = t.policy
                mode = t.mode
                policyName = welcome?.policies.first { $0.id == t.policy }?.name ?? ""
            }
            if !seenFirstTelemetry {
                seenFirstTelemetry = true
                if role == .operator && t.mode == .stopped { setMode(.manual) }
            }
        case .welcome(let w):
            if welcome?.sessionID != w.sessionID { mode = w.mode }
            welcome = w
            status = .live
        case .session(let s):
            role = s.grantedRole
            operatorId = s.operatorID
        case .event(let e):
            if e.kind == .mode { mode = e.mode }
        default:
            break
        }
    }
}
