import Foundation

struct TwinSpec: Decodable {
    let version: Int
    let robot: String
    let root: String
    let base: String?
    let bodies: [String]
    let joints: [TwinJoint]
}

struct TwinJoint: Decodable {
    let name: String
    let prim: String
    let body: String
    let kind: String
    let axis: [Float]
    let pos: [Float]
}
