import SwiftUI

struct RobotListView: View {
    @Environment(ServerSettings.self) private var settings
    @Environment(\.openWindow) private var openWindow
    @State private var robots: [FleetRobot] = []
    @State private var error: String?

    var body: some View {
        @Bindable var settings = settings
        VStack(spacing: 12) {
            HStack {
                TextField("Server", text: $settings.baseURL)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .onSubmit { Task { await reload() } }
                Button("Refresh") {
                    clearCache()
                    Task { await reload() }
                }
            }
            if let error {
                Text("Could not reach \(settings.trimmedBaseURL): \(error)")
                    .foregroundStyle(.secondary)
                Button("Retry") { Task { await reload() } }
            }
            List(robots) { robot in
                Button {
                    openWindow(id: "twin", value: robot.id)
                } label: {
                    VStack(alignment: .leading) {
                        Text(robot.name)
                        Text(robot.category).font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
            Text("Pair: \(String(settings.pairToken.prefix(8)))")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding()
        .task { await reload() }
    }

    private func reload() async {
        do {
            robots = try await loadFleet(settings)
            error = nil
        } catch {
            robots = []
            self.error = error.localizedDescription
        }
    }
}
