import Foundation

func requireSuccess(_ response: URLResponse) throws {
    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
        throw URLError(.badServerResponse)
    }
}

func loadFleet(_ settings: ServerSettings) async throws -> [FleetRobot] {
    let (data, response) = try await URLSession.shared.data(from: settings.url("/api/robots"))
    try requireSuccess(response)
    return try JSONDecoder().decode([FleetRobot].self, from: data)
}
