import simd

private func translation(_ t: SIMD3<Float>) -> float4x4 {
    var m = matrix_identity_float4x4
    m.columns.3 = SIMD4<Float>(t, 1)
    return m
}

func jointTransform(kind: String, axis: SIMD3<Float>, pos: SIMD3<Float>, q: Float) -> float4x4 {
    if kind == "slide" { return translation(axis * q) }
    let n = simd_length(axis) > 0 ? simd_normalize(axis) : SIMD3<Float>(0, 0, 1)
    let r = float4x4(simd_quatf(angle: q, axis: n))
    return translation(pos) * r * translation(-pos)
}

private func perpendicular(_ v: SIMD3<Float>, to axis: SIMD3<Float>) -> SIMD3<Float> {
    v - simd_dot(v, axis) * axis
}

func hingeDelta(start: SIMD3<Float>, current: SIMD3<Float>, anchor: SIMD3<Float>, axis: SIMD3<Float>) -> Float {
    let a = simd_normalize(axis)
    let v0 = perpendicular(start - anchor, to: a)
    let v1 = perpendicular(current - anchor, to: a)
    if simd_length(v0) < 0.001 || simd_length(v1) < 0.001 { return 0 }
    return atan2(simd_dot(simd_cross(v0, v1), a), simd_dot(v0, v1))
}

func slideDelta(start: SIMD3<Float>, current: SIMD3<Float>, axis: SIMD3<Float>, scale: Float) -> Float {
    simd_dot(current - start, axis) / scale
}
