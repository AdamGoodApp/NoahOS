// Builds a three.js object tree from a parsed MJCF model. Browser-only.
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SphereGeometry,
  Vector3,
} from 'three'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js'

import type { JointType, MjcfBody, MjcfGeom, MjcfModel } from './parse'

/** MuJoCo shows geom groups 0–2 by default; Menagerie puts collision geoms in group 3. */
const MAX_VISIBLE_GROUP = 2

export type JointNode = {
  name: string
  body: string
  type: JointType
  axis: Vector3
  pos: Vector3
  range: [number, number] | null
  pivot: Group
  /** The joint's body frame; a free joint places it directly. */
  bodyObject: Group
  /** Hinge or slide value (rad or m). */
  value: number
  /** Free (x y z qw qx qy qz) or ball (qw qx qy qz) coordinates, as in MuJoCo's qpos. */
  qpos: number[]
}

export type BodyNode = {
  /** Body placement before its own joints act. */
  object: Group
  /** Body frame after its joints: geoms, inertial and child bodies live here. */
  frame: Group
  meshes: Mesh[]
  inertial: { mass: number; pos: Vector3 } | null
  children: string[]
}

export type BuiltRobot = {
  root: Group
  bodies: Map<string, BodyNode>
  joints: Map<string, JointNode>
  /** Every joint in document order (qpos order), including free and ball joints. */
  jointOrder: string[]
  /** Sum of every body's inertial mass (kg). */
  totalMass: number
}

const visible = (g: MjcfGeom) => g.group <= MAX_VISIBLE_GROUP && g.rgba[3] > 0 && g.type !== 'plane'

function* walk(bodies: MjcfBody[]): Generator<MjcfBody> {
  for (const b of bodies) {
    yield b
    yield* walk(b.children)
  }
}

/** Loads every visible mesh once; returns templates keyed by mesh name. Rejects with the failing file name. */
export async function loadMeshAssets(
  model: MjcfModel,
  baseUrl: string,
  onProgress: (loaded: number, total: number) => void,
): Promise<Map<string, Object3D>> {
  const names = new Set<string>()
  for (const body of walk(model.bodies)) {
    for (const g of body.geoms) if (g.type === 'mesh' && g.mesh && visible(g) && model.meshes[g.mesh]) names.add(g.mesh)
  }
  const dir = model.meshDir ? `${baseUrl}/${model.meshDir.replace(/\/$/, '')}` : baseUrl
  const stl = new STLLoader()
  const obj = new OBJLoader()
  const templates = new Map<string, Object3D>()
  let loaded = 0
  onProgress(0, names.size)
  await Promise.all(
    [...names].map(async (name) => {
      const { file, scale } = model.meshes[name]!
      const url = `${dir}/${file}`
      let template: Object3D
      try {
        if (/\.stl$/i.test(file)) {
          template = new Mesh(await stl.loadAsync(url))
        } else if (/\.obj$/i.test(file)) {
          const group = await obj.loadAsync(url)
          template = new Group()
          for (const child of [...group.children]) if (child instanceof Mesh) template.add(child)
        } else {
          throw new Error(`Unsupported mesh format: ${file}`)
        }
      } catch {
        throw new Error(file)
      }
      template.traverse((o) => {
        if (!(o instanceof Mesh)) return
        const geometry = o.geometry as BufferGeometry
        geometry.scale(scale[0], scale[1], scale[2])
        if (!geometry.getAttribute('normal')) geometry.computeVertexNormals()
      })
      templates.set(name, template)
      onProgress(++loaded, names.size)
    }),
  )
  return templates
}

function material([r, g, b, a]: MjcfGeom['rgba']) {
  return new MeshStandardMaterial({
    color: new Color(r, g, b),
    roughness: 0.7,
    metalness: 0.05,
    transparent: a < 1,
    opacity: a,
  })
}

/** Primitive geometry in the geom frame (MuJoCo capsules and cylinders run along local Z). */
function primitive(g: MjcfGeom, halfLength?: number): BufferGeometry | null {
  const [s0 = 0.01, s1 = s0, s2 = s1] = g.size
  switch (g.type) {
    case 'box':
      return new BoxGeometry(2 * s0, 2 * s1, 2 * s2)
    case 'sphere':
      return new SphereGeometry(s0, 32, 16)
    case 'capsule':
      return new CapsuleGeometry(s0, 2 * (halfLength ?? s1), 8, 16).rotateX(Math.PI / 2)
    case 'cylinder':
      return new CylinderGeometry(s0, s0, 2 * (halfLength ?? s1), 32).rotateX(Math.PI / 2)
    case 'ellipsoid':
      return new SphereGeometry(1, 32, 16).scale(s0, s1, s2)
    default:
      return null
  }
}

function buildGeom(g: MjcfGeom, body: string, assets: Map<string, Object3D>): { object: Object3D; meshes: Mesh[] } | null {
  let object: Object3D
  const meshes: Mesh[] = []
  let from: Vector3 | undefined
  let to: Vector3 | undefined
  if (g.fromto) {
    from = new Vector3(g.fromto[0], g.fromto[1], g.fromto[2])
    to = new Vector3(g.fromto[3], g.fromto[4], g.fromto[5])
  }
  if (g.type === 'mesh') {
    const template = g.mesh ? assets.get(g.mesh) : undefined
    if (!template) return null
    object = template.clone()
    object.traverse((o) => {
      if (o instanceof Mesh) {
        o.material = material(g.rgba)
        meshes.push(o)
      }
    })
  } else {
    const geometry = primitive(g, from && to ? from.distanceTo(to) / 2 : undefined)
    if (!geometry) return null
    const mesh = new Mesh(geometry, material(g.rgba))
    meshes.push(mesh)
    object = mesh
  }
  if (from && to) {
    object.position.copy(from).add(to).multiplyScalar(0.5)
    const dir = to.sub(from)
    if (dir.lengthSq() > 0) object.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), dir.normalize())
  } else {
    object.position.set(...g.pos)
    object.quaternion.set(...g.quat)
  }
  for (const m of meshes) m.userData.body = body
  return { object, meshes }
}

export function buildRobot(model: MjcfModel, assets: Map<string, Object3D>): BuiltRobot {
  const robot: BuiltRobot = { root: new Group(), bodies: new Map(), joints: new Map(), jointOrder: [], totalMass: 0 }

  const addBody = (b: MjcfBody, parent: Object3D) => {
    const object = new Group()
    object.name = b.name
    object.position.set(...b.pos)
    object.quaternion.set(...b.quat)
    parent.add(object)

    // Each joint: pivot at the joint position (driven), inner group undoing the offset; joints nest in order.
    let inner: Group = object
    for (const j of b.joints) {
      const pos = new Vector3(...j.pos)
      const pivot = new Group()
      pivot.position.copy(pos)
      const offset = new Group()
      offset.position.copy(pos).negate()
      pivot.add(offset)
      inner.add(pivot)
      inner = offset
      robot.jointOrder.push(j.name)
      robot.joints.set(j.name, {
        name: j.name,
        body: b.name,
        type: j.type,
        axis: new Vector3(...j.axis).normalize(),
        pos,
        range: j.range,
        pivot,
        bodyObject: object,
        value: 0,
        // A free joint's default qpos is the body's own pose; a ball joint's is the identity rotation.
        qpos: j.type === 'free' ? [...b.pos, b.quat[3], b.quat[0], b.quat[1], b.quat[2]] : j.type === 'ball' ? [1, 0, 0, 0] : [],
      })
    }

    const meshes: Mesh[] = []
    for (const g of b.geoms) {
      if (!visible(g)) continue
      const built = buildGeom(g, b.name, assets)
      if (!built) continue
      inner.add(built.object)
      meshes.push(...built.meshes)
    }
    robot.totalMass += b.inertial?.mass ?? 0
    robot.bodies.set(b.name, {
      object,
      frame: inner,
      meshes,
      inertial: b.inertial ? { mass: b.inertial.mass, pos: new Vector3(...b.inertial.pos) } : null,
      children: b.children.map((c) => c.name),
    })
    for (const child of b.children) addBody(child, inner)
  }

  for (const b of model.bodies) addBody(b, robot.root)
  return robot
}

/**
 * Free and ball joints have several coordinates; each is stored as its own value under `name#index`
 * so undo, redo and live telemetry can treat every coordinate as a plain number.
 */
export const coordinateKey = (joint: string, index: number) => `${joint}#${index}`

/** Default coordinates of every free and ball joint (the model's rest placement). */
export function baseValues(robot: BuiltRobot): Record<string, number> {
  const values: Record<string, number> = {}
  for (const joint of robot.joints.values()) joint.qpos.forEach((v, k) => (values[coordinateKey(joint.name, k)] = v))
  return values
}

const rotation = new Quaternion()

/** Sets a hinge/slide value, or one free/ball coordinate addressed by `coordinateKey`. */
export function setJoint(robot: BuiltRobot, key: string, value: number): void {
  const hash = key.lastIndexOf('#')
  const joint = robot.joints.get(hash < 0 ? key : key.slice(0, hash))
  if (!joint) return
  if (hash >= 0) {
    joint.qpos[Number(key.slice(hash + 1))] = value
    const q = joint.qpos
    if (joint.type === 'free') {
      joint.bodyObject.position.set(q[0] ?? 0, q[1] ?? 0, q[2] ?? 0)
      joint.bodyObject.quaternion.set(q[4] ?? 0, q[5] ?? 0, q[6] ?? 0, q[3] ?? 1).normalize()
    } else if (joint.type === 'ball') {
      joint.pivot.quaternion.set(q[1] ?? 0, q[2] ?? 0, q[3] ?? 0, q[0] ?? 1).normalize()
    }
    return
  }
  joint.value = value
  if (joint.type === 'hinge') {
    joint.pivot.quaternion.copy(rotation.setFromAxisAngle(joint.axis, value))
  } else if (joint.type === 'slide') {
    joint.pivot.position.copy(joint.pos).addScaledVector(joint.axis, value)
  }
}

const GRAVITY = 9.81

/** Static load on one hinge or slide joint from the mass it carries, at the current pose. */
export type JointStats = {
  /** World centre of mass of everything the joint moves (m). */
  cog: [number, number, number]
  /** Mass the joint moves (kg) and its share of the robot's mass. */
  mass: number
  massFraction: number
  /** Gravity torque about the hinge axis (N·m) or force along the slide axis (N). */
  load: number
  /** |load| relative to the most it could be for this mass and lever (0–1). */
  loadFraction: number
}

/** Null when the joint is not a hinge or slide, or the model gives no mass for part of what it moves. */
export function jointStats(robot: BuiltRobot, name: string): JointStats | null {
  const joint = robot.joints.get(name)
  if (!joint || (joint.type !== 'hinge' && joint.type !== 'slide')) return null
  robot.root.updateMatrixWorld(true)

  const cog = new Vector3()
  let mass = 0
  const stack = [joint.body]
  while (stack.length) {
    const body = robot.bodies.get(stack.pop()!)
    if (!body?.inertial) return null
    cog.addScaledVector(body.frame.localToWorld(body.inertial.pos.clone()), body.inertial.mass)
    mass += body.inertial.mass
    stack.push(...body.children)
  }
  if (mass <= 0) return null
  cog.divideScalar(mass)

  const total = robot.totalMass

  const weight = new Vector3(0, 0, -GRAVITY * mass)
  const axis = joint.axis.clone().applyQuaternion(joint.pivot.getWorldQuaternion(new Quaternion()))
  let load: number
  let max: number
  if (joint.type === 'hinge') {
    const lever = cog.clone().sub(joint.pivot.getWorldPosition(new Vector3()))
    load = axis.dot(lever.clone().cross(weight))
    max = GRAVITY * mass * lever.length()
  } else {
    load = axis.dot(weight)
    max = GRAVITY * mass
  }
  return {
    cog: [cog.x, cog.y, cog.z],
    mass,
    massFraction: total > 0 ? mass / total : 0,
    load,
    loadFraction: max > 0 ? Math.min(Math.abs(load) / max, 1) : 0,
  }
}

/**
 * A world point that shows where a joint's part points: the centre of mass of everything it moves, or the
 * centre of those parts' bounding box when the model gives no masses.
 */
export function jointAimPoint(robot: BuiltRobot, name: string): Vector3 | null {
  const joint = robot.joints.get(name)
  const body = joint && robot.bodies.get(joint.body)
  if (!joint || !body) return null
  const stats = jointStats(robot, name)
  if (stats) return new Vector3(...stats.cog)
  const box = new Box3().setFromObject(body.frame)
  return box.isEmpty() ? null : box.getCenter(new Vector3())
}

/** Hinge and slide joints from `body` up to the root (nearest first), stopping at a floating base. */
export function ikChain(robot: BuiltRobot, body: string): JointNode[] {
  const parentOf = new Map<string, string>()
  for (const [name, node] of robot.bodies) for (const child of node.children) parentOf.set(child, name)
  const byBody = new Map<string, JointNode[]>()
  for (const joint of robot.joints.values()) byBody.set(joint.body, [...(byBody.get(joint.body) ?? []), joint])
  const chain: JointNode[] = []
  for (let b: string | undefined = body; b; b = parentOf.get(b)) {
    const joints = byBody.get(b) ?? []
    if (joints.some((j) => j.type === 'free')) break
    // Within a body, later joints sit nearer the part.
    for (const j of [...joints].reverse()) if (j.type === 'hinge' || j.type === 'slide') chain.push(j)
  }
  return chain
}

const IK_ITERATIONS = 24
const IK_TOLERANCE_M = 5e-4
/** Largest turn one joint makes per step, so the chain bends smoothly instead of flipping. */
const IK_MAX_STEP_RAD = 0.35

/**
 * Cyclic coordinate descent: turns (or slides) each joint of `chain` in turn, nearest the part first, to bring
 * `effector()` toward `target`, within every joint's limits. Mutates the robot's joints.
 */
export function solveIk(robot: BuiltRobot, chain: JointNode[], effector: () => Vector3, target: Vector3): void {
  const p = new Vector3()
  const a = new Vector3()
  const q = new Quaternion()
  const toE = new Vector3()
  const toT = new Vector3()
  const cross = new Vector3()
  for (let it = 0; it < IK_ITERATIONS; it++) {
    for (const joint of chain) {
      // `effector()` and the pivot's world getters refresh only the matrices on their own path to the root.
      const e = effector()
      if (e.distanceTo(target) < IK_TOLERANCE_M) return
      a.copy(joint.axis).applyQuaternion(joint.pivot.getWorldQuaternion(q)).normalize()
      let next: number
      if (joint.type === 'hinge') {
        joint.pivot.getWorldPosition(p)
        // Only the components across the axis change as the hinge turns.
        toE.subVectors(e, p)
        toE.addScaledVector(a, -toE.dot(a))
        toT.subVectors(target, p)
        toT.addScaledVector(a, -toT.dot(a))
        if (toE.lengthSq() < 1e-10 || toT.lengthSq() < 1e-10) continue
        const angle = Math.atan2(a.dot(cross.crossVectors(toE, toT)), toE.dot(toT))
        next = joint.value + Math.max(-IK_MAX_STEP_RAD, Math.min(IK_MAX_STEP_RAD, angle))
      } else {
        next = joint.value + toT.subVectors(target, e).dot(a)
      }
      if (joint.range) next = Math.min(Math.max(next, joint.range[0]), joint.range[1])
      setJoint(robot, joint.name, next)
    }
  }
}
