import Foundation
import Observation

@Observable
final class ServerSettings {
    var baseURL: String {
        didSet { UserDefaults.standard.set(trimmedBaseURL, forKey: "serverURL") }
    }
    let clientId: String
    let pairToken: String

    init() {
        let d = UserDefaults.standard
        baseURL = Self.trimmingSlashes(d.string(forKey: "serverURL") ?? "http://localhost:3100")
        if let c = d.string(forKey: "clientId") {
            clientId = c
        } else {
            clientId = UUID().uuidString.lowercased()
            d.set(clientId, forKey: "clientId")
        }
        if let p = d.string(forKey: "pairToken") {
            pairToken = p
        } else {
            pairToken = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            d.set(pairToken, forKey: "pairToken")
        }
    }

    /// `baseURL` without trailing slashes.
    var trimmedBaseURL: String { Self.trimmingSlashes(baseURL) }

    func url(_ path: String) throws -> URL {
        guard let url = URL(string: trimmedBaseURL + path) else { throw URLError(.badURL) }
        return url
    }

    private static func trimmingSlashes(_ s: String) -> String {
        var s = s
        while s.hasSuffix("/") { s.removeLast() }
        return s
    }
}
