"""USDZ twins of the compiled MuJoCo models.

Writes the same body -> joint pivot -> geom tree the browser builds (apps/web/src/lib/mjcf/build.ts), so a viewer can
drive every joint by setting one transform from a qpos value. `/Robot` is rotated X -90 degrees (MuJoCo Z-up to
USD Y-up); everything below it is in MuJoCo coordinates. `pxr` is imported inside functions only: the sim image
never installs usd-core.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

import mujoco
import numpy as np

from .models import FLOOR, LoadedModel

_DEFAULT_RGBA = (0.5, 0.5, 0.5, 1.0)


def sanitize(name: str, taken: set[str], fallback: str) -> str:
    """A valid, unique USD prim name for an MJCF name; registers it in `taken`."""
    base = re.sub(r"[^A-Za-z0-9_]", "_", name)
    if base and base[0].isdigit():
        base = "_" + base
    if not base:
        base = fallback
    out, n = base, 1
    while out in taken:
        n += 1
        out = f"{base}_{n}"
    taken.add(out)
    return out


def _vertex_normals(points: np.ndarray, faces: np.ndarray) -> np.ndarray:
    p = points.astype(np.float64)
    tri = p[faces]
    fn = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])  # length = 2 * area
    acc = np.zeros_like(p)
    for k in range(3):
        np.add.at(acc, faces[:, k], fn)
    length = np.linalg.norm(acc, axis=1)
    ok = length > 1e-12
    acc[ok] /= length[ok, None]
    acc[~ok] = (0.0, 0.0, 1.0)
    return acc


def _box(half: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    pts: list[np.ndarray] = []
    faces: list[list[int]] = []
    for axis in range(3):
        u, v = (axis + 1) % 3, (axis + 2) % 3
        for sign in (-1.0, 1.0):
            base = len(pts)
            for su, sv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                c = np.zeros(3)
                c[axis], c[u], c[v] = sign * half[axis], su * half[u], sv * half[v]
                pts.append(c)
            # (u, v, axis) is a right-handed frame, so the quad is counter-clockwise seen from +axis
            quad = [base, base + 1, base + 2, base, base + 2, base + 3]
            if sign < 0:
                quad = [quad[0], quad[2], quad[1], quad[3], quad[5], quad[4]]
            faces += [quad[:3], quad[3:]]
    return np.array(pts), np.array(faces, dtype=np.int64)


def _revolve(profile: list[tuple[float, float]], seg: int = 32) -> tuple[np.ndarray, np.ndarray]:
    """Surface of revolution about Z of a profile (radius, z) listed bottom to top; r == 0 marks a pole."""
    ang = np.linspace(0.0, 2.0 * np.pi, seg, endpoint=False)
    pts: list[np.ndarray] = []
    rings: list[list[int]] = []
    for r, z in profile:
        if r <= 1e-12:
            rings.append([len(pts)])
            pts.append(np.array([0.0, 0.0, z]))
        else:
            rings.append(list(range(len(pts), len(pts) + seg)))
            pts.extend(np.array([r * np.cos(a), r * np.sin(a), z]) for a in ang)
    tris: list[tuple[int, int, int]] = []
    for i in range(len(rings) - 1):
        lo, hi = rings[i], rings[i + 1]
        for k in range(seg):
            k1 = (k + 1) % seg
            if len(lo) == 1 and len(hi) == 1:
                continue
            if len(lo) == 1:
                tris.append((lo[0], hi[k1], hi[k]))
            elif len(hi) == 1:
                tris.append((lo[k], lo[k1], hi[0]))
            else:
                tris.append((lo[k], lo[k1], hi[k1]))
                tris.append((lo[k], hi[k1], hi[k]))
    return np.array(pts), np.array(tris, dtype=np.int64)


def _sphere_profile(radius: float, rings: int, z0: float, lo: float, hi: float) -> list[tuple[float, float]]:
    phis = np.linspace(lo, hi, rings + 1)
    return [(radius * float(np.cos(p)), z0 + radius * float(np.sin(p))) for p in phis]


def _primitive(gtype: int, size: np.ndarray) -> tuple[np.ndarray, np.ndarray] | None:
    t = mujoco.mjtGeom
    if gtype == t.mjGEOM_BOX:
        return _box(size[:3])
    if gtype in (t.mjGEOM_SPHERE, t.mjGEOM_ELLIPSOID):
        pts, faces = _revolve(_sphere_profile(1.0, 16, 0.0, -np.pi / 2, np.pi / 2))
        scale = np.full(3, size[0]) if gtype == t.mjGEOM_SPHERE else size[:3]
        return pts * scale, faces
    if gtype == t.mjGEOM_CYLINDER:
        r, h = float(size[0]), float(size[1])
        return _revolve([(0.0, -h), (r, -h), (r, h), (0.0, h)])
    if gtype == t.mjGEOM_CAPSULE:
        r, h = float(size[0]), float(size[1])
        profile = _sphere_profile(r, 8, -h, -np.pi / 2, 0.0) + _sphere_profile(r, 8, h, 0.0, np.pi / 2)
        # the equator ring appears in both halves: drop the duplicate
        profile = profile[:8] + profile[9:]
        return _revolve(profile)
    return None


def _quat(Gf: Any, q: np.ndarray) -> Any:
    return Gf.Quatf(float(q[0]), Gf.Vec3f(float(q[1]), float(q[2]), float(q[3])))


def _axis_quat(Gf: Any, axis: np.ndarray, angle: float) -> Any:
    s = np.sin(angle / 2.0)
    return Gf.Quatf(float(np.cos(angle / 2.0)), Gf.Vec3f(*(float(c) for c in axis * s)))


def _vec3(Gf: Any, v: Any) -> Any:
    return Gf.Vec3d(float(v[0]), float(v[1]), float(v[2]))


def export(lm: LoadedModel, out_dir: Path) -> dict:
    """Write `<id>.usdz` and `<id>.json` into `out_dir`; returns the JSON document."""
    from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade, UsdUtils, Vt

    m = lm.model
    rid = lm.robot.id
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    taken: set[str] = set()

    base_joint = -1
    if lm.has_base:
        for j in range(m.njnt):
            if m.jnt_type[j] == mujoco.mjtJoint.mjJNT_FREE and int(m.jnt_qposadr[j]) == lm.base_qadr:
                base_joint = j
    base_body = int(m.jnt_bodyid[base_joint]) if base_joint >= 0 else -1

    body_prims: dict[int, str] = {}
    joint_prims: dict[int, str] = {}
    joint_body: dict[int, str] = {}
    materials: dict[tuple[float, ...], Any] = {}

    with tempfile.TemporaryDirectory() as tmp:
        usdc = Path(tmp) / f"{rid}.usdc"
        stage = Usd.Stage.CreateNew(str(usdc))
        UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
        UsdGeom.SetStageMetersPerUnit(stage, 1.0)
        root = UsdGeom.Xform.Define(stage, "/Robot")
        root.AddRotateXOp().Set(-90.0)
        stage.SetDefaultPrim(root.GetPrim())
        UsdGeom.Scope.Define(stage, "/Robot/Materials")

        def material_for(rgba: np.ndarray) -> Any:
            key = tuple(round(float(c), 6) for c in rgba)
            if key not in materials:
                path = f"/Robot/Materials/M{len(materials)}"
                mat = UsdShade.Material.Define(stage, path)
                sh = UsdShade.Shader.Define(stage, f"{path}/Surface")
                sh.CreateIdAttr("UsdPreviewSurface")
                sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*key[:3]))
                sh.CreateInput("opacity", Sdf.ValueTypeNames.Float).Set(key[3])
                sh.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(0.7)
                sh.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(0.05)
                mat.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), "surface")
                materials[key] = mat
            return materials[key]

        def add_geom(parent: str, g: int) -> None:
            gtype = int(m.geom_type[g])
            name = m.geom(g).name
            if gtype == mujoco.mjtGeom.mjGEOM_PLANE or name == FLOOR or int(m.geom_group[g]) >= 3:
                return
            rgba = m.geom_rgba[g].copy()
            mid = int(m.geom_matid[g])
            if mid >= 0 and np.allclose(rgba, _DEFAULT_RGBA):
                rgba = m.mat_rgba[mid].copy()
            if rgba[3] <= 0:
                return
            if gtype == mujoco.mjtGeom.mjGEOM_MESH:
                d = int(m.geom_dataid[g])
                va, vn = int(m.mesh_vertadr[d]), int(m.mesh_vertnum[d])
                fa, fn = int(m.mesh_faceadr[d]), int(m.mesh_facenum[d])
                shape: tuple[np.ndarray, np.ndarray] | None = (
                    m.mesh_vert[va : va + vn].astype(np.float64),
                    m.mesh_face[fa : fa + fn].astype(np.int64),
                )
            else:
                shape = _primitive(gtype, m.geom_size[g])
            if shape is None:
                return
            pts, faces = shape
            prim = sanitize(name, taken, f"geom{g}")
            mesh = UsdGeom.Mesh.Define(stage, f"{parent}/{prim}")
            mesh.AddTranslateOp().Set(_vec3(Gf, m.geom_pos[g]))
            mesh.AddOrientOp().Set(_quat(Gf, m.geom_quat[g]))
            mesh.CreateSubdivisionSchemeAttr().Set(UsdGeom.Tokens.none)
            mesh.CreateDoubleSidedAttr().Set(True)
            mesh.CreatePointsAttr().Set(Vt.Vec3fArray.FromNumpy(pts.astype(np.float32)))
            mesh.CreateFaceVertexCountsAttr().Set(Vt.IntArray.FromNumpy(np.full(len(faces), 3, dtype=np.int32)))
            mesh.CreateFaceVertexIndicesAttr().Set(Vt.IntArray.FromNumpy(faces.reshape(-1).astype(np.int32)))
            mesh.CreateNormalsAttr().Set(Vt.Vec3fArray.FromNumpy(_vertex_normals(pts, faces).astype(np.float32)))
            mesh.SetNormalsInterpolation(UsdGeom.Tokens.vertex)
            UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(material_for(rgba))

        def add_body(b: int, parent: str) -> None:
            prim = sanitize(m.body(b).name, taken, f"body{b}")
            body_prims[b] = prim
            path = f"{parent}/{prim}"
            xf = UsdGeom.Xform.Define(stage, path)
            if b == base_body:
                q = lm.initial_qpos[lm.base_qadr : lm.base_qadr + 7]
                xf.AddTranslateOp().Set(_vec3(Gf, q[:3]))
                xf.AddOrientOp().Set(_quat(Gf, q[3:7]))
            else:
                xf.AddTranslateOp().Set(_vec3(Gf, m.body_pos[b]))
                xf.AddOrientOp().Set(_quat(Gf, m.body_quat[b]))
            inner = path
            for j in range(m.njnt):
                if int(m.jnt_bodyid[j]) != b:
                    continue
                jt = int(m.jnt_type[j])
                if jt == mujoco.mjtJoint.mjJNT_FREE:
                    continue
                if jt not in (mujoco.mjtJoint.mjJNT_HINGE, mujoco.mjtJoint.mjJNT_SLIDE):
                    raise ValueError(f"{rid}: joint {m.joint(j).name!r} has unsupported type {jt} (ball)")
                jprim = sanitize(m.joint(j).name, taken, f"joint{j}")
                joint_prims[j] = jprim
                joint_body[j] = prim
                inner = f"{inner}/{jprim}"
                jx = UsdGeom.Xform.Define(stage, inner)
                p = m.jnt_pos[j]
                a = m.jnt_axis[j] / np.linalg.norm(m.jnt_axis[j])
                q0 = float(lm.initial_qpos[int(m.jnt_qposadr[j])])
                if jt == mujoco.mjtJoint.mjJNT_HINGE:
                    jx.AddTranslateOp().Set(_vec3(Gf, p))
                    jx.AddOrientOp().Set(_axis_quat(Gf, a, q0))
                    jx.AddTranslateOp(opSuffix="inv").Set(_vec3(Gf, -p))
                else:
                    jx.AddTranslateOp().Set(_vec3(Gf, a * q0))
            for g in range(m.ngeom):
                if int(m.geom_bodyid[g]) == b:
                    add_geom(inner, g)
            for c in range(m.nbody):
                if int(m.body_parentid[c]) == b and c != b:
                    add_body(c, inner)

        for b in range(1, m.nbody):
            if int(m.body_parentid[b]) == 0:
                add_body(b, "/Robot")
        stage.Save()

        joints_json = []
        for ji in lm.joints:
            a = m.jnt_axis[ji.id] / np.linalg.norm(m.jnt_axis[ji.id])
            joints_json.append(
                {
                    "name": ji.name,
                    "prim": joint_prims[ji.id],
                    "body": joint_body[ji.id],
                    "kind": ji.kind,
                    "axis": [float(c) for c in a],
                    "pos": [float(c) for c in m.jnt_pos[ji.id]],
                }
            )
        spec = {
            "version": 1,
            "robot": rid,
            "root": "Robot",
            "base": body_prims[base_body] if base_body >= 0 else None,
            "bodies": [body_prims[b] for b in sorted(body_prims)],
            "joints": joints_json,
        }

        usdz = out_dir / f"{rid}.usdz"
        if usdz.exists():
            usdz.unlink()
        if not UsdUtils.CreateNewUsdzPackage(Sdf.AssetPath(str(usdc)), str(usdz)):
            raise RuntimeError(f"{rid}: could not write {usdz}")
        (out_dir / f"{rid}.json").write_text(json.dumps(spec, indent=1) + "\n")

    checker = shutil.which("usdchecker")
    if checker:
        r = subprocess.run([checker, "--arkit", str(usdz)], capture_output=True, text=True)
        if r.returncode != 0:
            raise RuntimeError(f"{rid}: usdchecker --arkit failed:\n{r.stdout}{r.stderr}")
    return spec


def set_pose(stage: Any, spec: dict, qpos: np.ndarray, lm: LoadedModel) -> None:
    """Pose the twin for a qpos vector; the reference for any viewer's transform math."""
    from pxr import Gf, Usd

    prims = {p.GetName(): p for p in stage.Traverse()}
    with Usd.EditContext(stage, stage.GetSessionLayer()):
        for js, ji in zip(spec["joints"], lm.joints, strict=True):
            prim = prims[js["prim"]]
            q = float(qpos[ji.qadr])
            axis = np.asarray(js["axis"], dtype=np.float64)
            if js["kind"] == "hinge":
                prim.GetAttribute("xformOp:orient").Set(_axis_quat(Gf, axis, q))
            else:
                prim.GetAttribute("xformOp:translate").Set(_vec3(Gf, axis * q))
        if spec["base"] is not None:
            base = prims[spec["base"]]
            b = qpos[lm.base_qadr : lm.base_qadr + 7]
            base.GetAttribute("xformOp:translate").Set(_vec3(Gf, b[:3]))
            base.GetAttribute("xformOp:orient").Set(_quat(Gf, b[3:7]))
