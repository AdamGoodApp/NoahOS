import Foundation

struct FleetRobot: Decodable, Identifiable {
    let id: String
    let name: String
    let category: String
    let usdz: String
    let twin: String
}
