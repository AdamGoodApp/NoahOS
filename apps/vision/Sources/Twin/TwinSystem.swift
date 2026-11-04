import RealityKit

struct TwinSystem: System {
    static let query = EntityQuery(where: .has(TwinComponent.self))

    init(scene: RealityKit.Scene) {}

    @MainActor
    func update(context: SceneUpdateContext) {
        for entity in context.entities(matching: Self.query, updatingSystemWhen: .rendering) {
            guard let twin = entity.components[TwinComponent.self]?.twin else { continue }
            if let t = twin.client.frames.take() { twin.apply(t) }
            twin.client.flushTargets()
        }
    }
}
