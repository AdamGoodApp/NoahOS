import SwiftUI
import RealityKit

@MainActor
@Observable
final class TwinModel {
    enum Phase: Equatable { case loading, ready, failed(String) }
    enum ScaleChoice: String, CaseIterable, Identifiable {
        case fit = "Fit", one = "1:1", quarter = "1:4"
        var id: String { rawValue }
    }

    var phase: Phase = .loading
    var client: LiveClient?
    var twin: RobotTwin?
    var scaleChoice: ScaleChoice = .fit { didSet { applyScale() } }
    private var fit: Float = 1

    func load(_ robotId: String, _ settings: ServerSettings, _ root: Entity) async {
        phase = .loading
        client?.close()
        twin?.robot.removeFromParent()
        twin = nil
        do {
            let fleet = try await loadFleet(settings)
            guard let entry = fleet.first(where: { $0.id == robotId }) else {
                phase = .failed("Unknown robot \(robotId)")
                return
            }
            let local = try await localTwin(for: entry, settings: settings)
            let c = LiveClient(robotId: robotId, settings: settings)
            client = c
            c.connect()
            var waited = 0.0
            while c.welcome == nil {
                if waited >= 20 { phase = .failed("No Welcome from the sim"); return }
                try await Task.sleep(nanoseconds: 100_000_000)
                waited += 0.1
            }
            let t = try await RobotTwin(usdz: local.usdz, spec: local.spec, client: c, welcome: c.welcome!, rootEntity: root)
            twin = t
            let e = t.robot.visualBounds(relativeTo: nil).extents
            let m = max(e.x, e.y, e.z)
            fit = m > 0 ? min(1, 1.3 / m) : 1
            applyScale()
            phase = .ready
        } catch {
            phase = .failed(error.localizedDescription)
        }
    }

    private func applyScale() {
        guard let r = twin?.robot else { return }
        let s: Float
        switch scaleChoice {
        case .fit: s = fit
        case .one: s = 1
        case .quarter: s = 0.25
        }
        r.scale = SIMD3(repeating: s)
    }
}

struct TwinVolumeView: View {
    let robotId: String
    @Environment(ServerSettings.self) private var settings
    @Environment(\.openURL) private var openURL
    @State private var model = TwinModel()
    @State private var root = Entity()

    var body: some View {
        RealityView { content in
            root.name = "TwinRoot"
            root.position = [0, -0.73, 0]
            content.add(root)
            Task { await model.load(robotId, settings, root) }
        }
        .gesture(
            DragGesture(minimumDistance: 0)
                .targetedToAnyEntity()
                .onChanged { v in model.twin?.drag(v) }
                .onEnded { v in model.twin?.endDrag(v) }
        )
        .ornament(attachmentAnchor: .scene(.bottom)) { controls }
        .onDisappear { model.client?.close() }
    }

    private var controls: some View {
        @Bindable var model = model
        return HStack(spacing: 12) {
            Text(statusText)
            switch model.phase {
            case .failed:
                Button("Retry") { Task { await model.load(robotId, settings, root) } }
            default:
                if let c = model.client {
                    if c.status == .idle || c.status == .error {
                        Button("Live view") { c.connect() }
                    } else {
                        Button("Stop") { c.stop() }
                    }
                    if c.status == .live && c.role == .operator && c.mode == .stopped {
                        Button("Hold pose") { c.hold() }
                    }
                    if c.status == .live && c.role != .operator && c.operatorId.isEmpty {
                        Button("Take control") { c.takeControl() }
                    }
                }
                Button("Open Control page") {
                    if let url = URL(string: "\(settings.trimmedBaseURL)/app/robots/\(robotId)?pair=\(settings.pairToken)") {
                        openURL(url)
                    }
                }
                Picker("Scale", selection: $model.scaleChoice) {
                    ForEach(TwinModel.ScaleChoice.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.menu)
            }
        }
        .padding()
        .glassBackgroundEffect()
    }

    private var statusText: String {
        switch model.phase {
        case .loading: return "Loading model…"
        case .failed(let m): return m
        case .ready:
            guard let c = model.client else { return "" }
            switch c.status {
            case .idle: return "Not live"
            case .error: return c.errorText
            case .connecting, .reconnecting: return "Connecting…"
            case .live:
                if c.mode == .stopped && c.role == .operator { return "Stopped by another user · press Hold pose" }
                if c.role != .operator { return "Viewing · open the Control page from here to pair" }
                if c.mode == .auto { return "Playing \(c.policyName) · pause it in the browser to move joints" }
                return "Manual hold · pinch and drag a part"
            }
        }
    }
}
