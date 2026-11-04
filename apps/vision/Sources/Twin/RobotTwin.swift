import Foundation
import RealityKit
import SwiftUI
import simd

enum TwinError: Error, LocalizedError {
    case mismatch(String, String)
    case missingPrim(String)
    var errorDescription: String? {
        switch self {
        case .mismatch(let a, let b): return "Model is for \(a) but the sim runs \(b)"
        case .missingPrim(let p): return "Model has no part named \(p)"
        }
    }
}

struct TwinComponent: Component {
    let twin: RobotTwin
}

@MainActor
final class RobotTwin {
    /// A spec joint resolved against the model and the sim's joint order.
    private struct Slot {
        let joint: TwinJoint
        let index: Int
        let entity: Entity
        let axis: SIMD3<Float>
        let pos: SIMD3<Float>
    }

    let robot: Entity
    let client: LiveClient
    private let welcome: Noahos_Sim_V1_Welcome
    /// Indexed like `welcome.robot.joints`; nil where the twin spec has no (usable) joint.
    private let slots: [Slot?]
    private let slotByPrim: [String: Slot]
    private let bodyNames: Set<String>
    private var baseEntity: Entity?
    private var lastQpos: [Float?]
    /// Dragged joints (by sim joint index) whose local target shadows telemetry until the sim catches up.
    private var overrides: [Int: (target: Float, deadline: Date)] = [:]

    private struct Drag {
        let slot: Slot
        let startWorld: SIMD3<Float>
        let anchorWorld: SIMD3<Float>
        let axisWorld: SIMD3<Float>
        let startValue: Float
        let scale: Float
    }
    private var drag: Drag?
    private var dragActive = false

    init(usdz: URL, spec: TwinSpec, client: LiveClient, welcome: Noahos_Sim_V1_Welcome, rootEntity: Entity) async throws {
        guard spec.robot == welcome.robot.robotID else {
            throw TwinError.mismatch(spec.robot, welcome.robot.robotID)
        }
        let robot = try await Entity(contentsOf: usdz)
        self.robot = robot
        self.client = client
        self.welcome = welcome
        bodyNames = Set(spec.bodies)
        var entities: [String: (joint: TwinJoint, entity: Entity)] = [:]
        for j in spec.joints {
            guard let e = robot.findEntity(named: j.prim) else { throw TwinError.missingPrim(j.prim) }
            entities[j.name] = (j, e)
        }
        var resolved: [Slot?] = []
        var byPrim: [String: Slot] = [:]
        for (i, js) in welcome.robot.joints.enumerated() {
            guard let (j, e) = entities[js.name], j.axis.count == 3, j.pos.count == 3 else {
                resolved.append(nil)
                continue
            }
            let slot = Slot(joint: j, index: i, entity: e,
                            axis: SIMD3(j.axis[0], j.axis[1], j.axis[2]), pos: SIMD3(j.pos[0], j.pos[1], j.pos[2]))
            byPrim[j.prim] = slot
            resolved.append(slot)
        }
        slots = resolved
        slotByPrim = byPrim
        lastQpos = Array(repeating: nil, count: resolved.count)
        baseEntity = spec.base.flatMap { robot.findEntity(named: $0) }
        robot.generateCollisionShapes(recursive: true)
        Self.makeInteractive(robot)
        rootEntity.addChild(robot)
        rootEntity.components.set(TwinComponent(twin: self))
    }

    private static func makeInteractive(_ e: Entity) {
        if e is ModelEntity {
            e.components.set(InputTargetComponent())
            e.components.set(HoverEffectComponent())
        }
        for c in e.children { makeInteractive(c) }
    }

    private func setJoint(_ s: Slot, _ q: Float) {
        s.entity.transform = Transform(matrix: jointTransform(kind: s.joint.kind, axis: s.axis, pos: s.pos, q: q))
    }

    func apply(_ t: Noahos_Sim_V1_Telemetry) {
        let qpos = t.qpos
        for i in 0..<min(slots.count, qpos.count) {
            let q = qpos[i]
            lastQpos[i] = q
            if overrides[i] != nil { continue }
            if let slot = slots[i] { setJoint(slot, q) }
        }
        if let base = baseEntity, t.hasBase {
            let b = t.base
            // The volume is 1.5 m wide and clips its content: a walk covers metres, so the base stays at the volume's
            // centre (like a tracking camera) while its height and heading follow the sim. The parts below still move.
            base.transform = Transform(scale: .one,
                                       rotation: simd_quatf(ix: b.qx, iy: b.qy, iz: b.qz, r: b.qw),
                                       translation: [0, 0, b.z])
        }
        if !overrides.isEmpty {
            let now = Date()
            for (i, o) in overrides where now >= o.deadline || abs((lastQpos[i] ?? o.target) - o.target) < 0.01 {
                overrides[i] = nil
            }
        }
    }

    // MARK: Drag

    func drag(_ value: EntityTargetValue<DragGesture.Value>) {
        if !dragActive {
            dragActive = true
            beginDrag(value)
        }
        updateDrag(value)
    }

    func beginDrag(_ value: EntityTargetValue<DragGesture.Value>) {
        drag = nil
        guard client.canControl else { return }
        var cur: Entity? = value.entity
        var found: Slot?
        while let e = cur {
            if let s = slotByPrim[e.name] { found = s; break }
            if bodyNames.contains(e.name) { return }
            cur = e.parent
        }
        guard let s = found, let parent = s.entity.parent else { return }
        let start = value.convert(value.startLocation3D, from: .local, to: .scene)
        let anchor = parent.convert(position: s.pos, to: nil)
        let axis = simd_normalize(parent.convert(direction: s.axis, to: nil))
        drag = Drag(slot: s, startWorld: start, anchorWorld: anchor, axisWorld: axis,
                    startValue: overrides[s.index]?.target ?? lastQpos[s.index] ?? 0, scale: robot.scale.x)
    }

    func updateDrag(_ value: EntityTargetValue<DragGesture.Value>) {
        guard let d = drag, client.canControl else { return }
        let cur = value.convert(value.location3D, from: .local, to: .scene)
        var target: Float
        if d.slot.joint.kind == "slide" {
            target = d.startValue + slideDelta(start: d.startWorld, current: cur, axis: d.axisWorld, scale: d.scale)
        } else {
            target = d.startValue + hingeDelta(start: d.startWorld, current: cur, anchor: d.anchorWorld, axis: d.axisWorld)
        }
        let limits = welcome.robot.joints[d.slot.index]
        if limits.limited { target = min(max(target, limits.rangeMin), limits.rangeMax) }
        overrides[d.slot.index] = (target, .distantFuture)
        setJoint(d.slot, target)
        client.queueTarget(index: d.slot.index, value: target)
    }

    /// The release carries the final location: apply it too (some input paths deliver no updates between press and release).
    func endDrag(_ value: EntityTargetValue<DragGesture.Value>) {
        updateDrag(value)
        dragActive = false
        if let d = drag, let o = overrides[d.slot.index] {
            overrides[d.slot.index] = (o.target, Date().addingTimeInterval(2))
        }
        drag = nil
    }
}
