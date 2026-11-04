import Foundation

private func twinsDirectory() throws -> URL {
    let caches = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
    let dir = caches.appendingPathComponent("twins", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
}

private func fetch(_ path: String, to dest: URL, settings: ServerSettings) async throws {
    if FileManager.default.fileExists(atPath: dest.path) { return }
    let (tmp, response) = try await URLSession.shared.download(from: settings.url(path))
    try requireSuccess(response)
    try? FileManager.default.removeItem(at: dest)
    try FileManager.default.moveItem(at: tmp, to: dest)
}

func localTwin(for robot: FleetRobot, settings: ServerSettings) async throws -> (usdz: URL, spec: TwinSpec) {
    let dir = try twinsDirectory()
    let usdz = dir.appendingPathComponent("\(robot.id).usdz")
    let json = dir.appendingPathComponent("\(robot.id).json")
    try await fetch(robot.usdz, to: usdz, settings: settings)
    try await fetch(robot.twin, to: json, settings: settings)
    let spec = try JSONDecoder().decode(TwinSpec.self, from: Data(contentsOf: json))
    return (usdz, spec)
}

func clearCache() {
    if let dir = try? twinsDirectory() { try? FileManager.default.removeItem(at: dir) }
}
