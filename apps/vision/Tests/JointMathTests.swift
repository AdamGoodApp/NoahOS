import XCTest
import simd
@testable import NoahOS

final class JointMathTests: XCTestCase {
    func testQuarterTurn() {
        let d = hingeDelta(start: [2, 0, 0], current: [1, 1, 0], anchor: [1, 0, 0], axis: [0, 0, 1])
        XCTAssertEqual(d, .pi / 2, accuracy: 1e-5)
    }

    func testDragAlongAxisIsZero() {
        let d = hingeDelta(start: [2, 0, 0], current: [2, 0, 5], anchor: [1, 0, 0], axis: [0, 0, 1])
        XCTAssertEqual(d, 0, accuracy: 1e-5)
    }

    func testSlideScale() {
        let d = slideDelta(start: [0, 0, 0], current: [0, 0, 0.1], axis: [0, 0, 1], scale: 0.5)
        XCTAssertEqual(d, 0.2, accuracy: 1e-6)
    }

    func testHingeFixesAnchor() {
        let pos = SIMD3<Float>(0.1, 0.2, 0.3)
        let m = jointTransform(kind: "hinge", axis: [0, 1, 0], pos: pos, q: 1.0)
        let p = m * SIMD4<Float>(pos, 1)
        XCTAssertEqual(p.x, pos.x, accuracy: 1e-5)
        XCTAssertEqual(p.y, pos.y, accuracy: 1e-5)
        XCTAssertEqual(p.z, pos.z, accuracy: 1e-5)
    }

    func testSlideTranslates() {
        let m = jointTransform(kind: "slide", axis: [0, 0, 1], pos: .zero, q: 0.02)
        XCTAssertEqual(m.columns.3.z, 0.02, accuracy: 1e-6)
        XCTAssertEqual(m.columns.3.x, 0, accuracy: 1e-6)
    }
}
