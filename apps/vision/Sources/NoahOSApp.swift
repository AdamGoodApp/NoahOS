import SwiftUI

@main
struct NoahOSApp: App {
    @State private var settings = ServerSettings()

    init() {
        TwinComponent.registerComponent()
        TwinSystem.registerSystem()
    }

    var body: some Scene {
        WindowGroup {
            RobotListView().environment(settings)
        }
        WindowGroup(id: "twin", for: String.self) { $id in
            TwinVolumeView(robotId: id ?? "").environment(settings)
        }
        .windowStyle(.volumetric)
        .defaultSize(width: 1.5, height: 1.5, depth: 1.5, in: .meters)
        .volumeWorldAlignment(.gravityAligned)
    }
}
