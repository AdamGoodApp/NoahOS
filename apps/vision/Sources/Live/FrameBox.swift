import Foundation

/// Hand-off between the socket task (60 Hz telemetry) and the render loop.
final class FrameBox: @unchecked Sendable {
    private let lock = NSLock()
    private var latest: Noahos_Sim_V1_Telemetry?
    private var pending: [Int: Float] = [:]

    func store(_ t: Noahos_Sim_V1_Telemetry) {
        lock.lock(); latest = t; lock.unlock()
    }

    func take() -> Noahos_Sim_V1_Telemetry? {
        lock.lock(); defer { lock.unlock() }
        let t = latest
        latest = nil
        return t
    }

    func queue(index: Int, value: Float) {
        lock.lock(); pending[index] = value; lock.unlock()
    }

    func drain() -> [Int: Float] {
        lock.lock(); defer { lock.unlock() }
        let p = pending
        pending = [:]
        return p
    }
}
