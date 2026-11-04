// Minimal MJCF (MuJoCo XML) reader for display: kinematic tree, visual geoms, joints.
// Physics, actuators, sensors, sites and textures are ignored. Browser-only (uses DOMParser).
import { Matrix4, Quaternion, Vector3 } from 'three'

export type Vec3 = [number, number, number]
/** three.js order: x, y, z, w. */
export type Quat = [number, number, number, number]
export type Rgba = [number, number, number, number]

export type GeomType = 'mesh' | 'box' | 'sphere' | 'capsule' | 'cylinder' | 'ellipsoid' | 'plane'
export type MjcfGeom = {
  name: string
  type: GeomType
  mesh?: string
  size: number[]
  fromto?: number[]
  pos: Vec3
  quat: Quat
  rgba: Rgba
  group: number
}
export type JointType = 'hinge' | 'slide' | 'ball' | 'free'
export type MjcfJoint = { name: string; type: JointType; axis: Vec3; pos: Vec3; range: [number, number] | null }
export type MjcfBody = {
  name: string
  pos: Vec3
  quat: Quat
  joints: MjcfJoint[]
  geoms: MjcfGeom[]
  children: MjcfBody[]
  /** Mass (kg) and centre of mass in the body frame; null when the model leaves it to be computed from geoms. */
  inertial: { mass: number; pos: Vec3 } | null
}
export type MjcfModel = {
  name: string
  meshDir: string
  meshes: Record<string, { file: string; scale: Vec3 }>
  /** Top-level bodies under `<worldbody>`. */
  bodies: MjcfBody[]
}

type Attrs = Record<string, string>
type ClassMaps = Record<string, Attrs>

const ORIENTATION = ['quat', 'euler', 'axisangle', 'xyaxes', 'zaxis'] as const
const GEOM_TYPES: Record<string, true> = { mesh: true, box: true, sphere: true, capsule: true, cylinder: true, ellipsoid: true, plane: true }
const JOINT_TYPES: Record<string, true> = { hinge: true, slide: true, ball: true, free: true }
const AXES: Record<string, Vector3> = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) }

function parseXml(text: string): Element {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  const error = doc.querySelector('parsererror')
  if (error) throw new Error(`Invalid MJCF: ${error.textContent?.slice(0, 200)}`)
  return doc.documentElement
}

function attrs(el: Element): Attrs {
  const out: Attrs = {}
  for (const a of Array.from(el.attributes)) out[a.name] = a.value
  return out
}

function kids(el: Element, tag?: string): Element[] {
  return Array.from(el.children).filter((c) => !tag || c.tagName === tag)
}

function nums(value: string | undefined): number[] | undefined {
  if (value === undefined) return undefined
  return value.trim().split(/\s+/).filter(Boolean).map(Number)
}

function vec3(value: string | undefined, fallback: Vec3 = [0, 0, 0]): Vec3 {
  const n = nums(value)
  if (!n || n.length < 3) return fallback
  const [x = 0, y = 0, z = 0] = n
  return [x, y, z]
}

/** Replaces every `<include file>` with the root children of the included document, recursively. */
async function expandIncludes(el: Element, resolve: (file: string) => Promise<string>): Promise<void> {
  for (const child of kids(el)) {
    if (child.tagName === 'include') {
      const file = child.getAttribute('file')
      if (!file) {
        child.remove()
        continue
      }
      const included = parseXml(await resolve(file))
      await expandIncludes(included, resolve)
      for (const node of kids(included)) el.insertBefore(el.ownerDocument.importNode(node, true), child)
      child.remove()
    } else {
      await expandIncludes(child, resolve)
    }
  }
}

export async function parseMjcf(xmlText: string, resolveInclude: (file: string) => Promise<string>): Promise<MjcfModel> {
  const root = parseXml(xmlText)
  await expandIncludes(root, resolveInclude)

  const compiler = Object.assign({}, ...kids(root, 'compiler').map(attrs)) as Attrs
  const meshDir = compiler.meshdir ?? compiler.assetdir ?? ''
  const degrees = (compiler.angle ?? 'degree') === 'degree'
  const eulerSeq = compiler.eulerseq ?? 'xyz'
  const angle = (v: number) => (degrees ? (v * Math.PI) / 180 : v)

  // Default classes: each class holds per-element attribute maps merged over its parent class.
  const classes = new Map<string, ClassMaps>()
  const walkDefault = (el: Element, parent: ClassMaps) => {
    const maps: ClassMaps = {}
    for (const [tag, map] of Object.entries(parent)) maps[tag] = { ...map }
    for (const child of kids(el)) {
      if (child.tagName !== 'default') maps[child.tagName] = { ...maps[child.tagName], ...attrs(child) }
    }
    classes.set(el.getAttribute('class') ?? 'main', maps)
    for (const child of kids(el, 'default')) walkDefault(child, maps)
  }
  for (const el of kids(root, 'default')) walkDefault(el, {})

  /** Class attributes for `tag` overlaid with the element's own attributes. */
  const effective = (el: Element, tag: string, childClass: string | undefined): { own: Attrs; cls: Attrs; all: Attrs } => {
    const own = attrs(el)
    const cls = classes.get(own.class ?? childClass ?? 'main')?.[tag] ?? {}
    return { own, cls, all: { ...cls, ...own } }
  }

  const orientation = (own: Attrs, cls: Attrs): Quat => {
    const source = ORIENTATION.some((k) => k in own) ? own : cls
    const q = new Quaternion()
    if (source.quat) {
      const [w = 1, x = 0, y = 0, z = 0] = nums(source.quat)!
      q.set(x, y, z, w).normalize()
    } else if (source.euler) {
      const e = nums(source.euler)!
      for (let i = 0; i < 3; i++) {
        const letter = eulerSeq.charAt(i) || 'xyz'.charAt(i)
        const axis = AXES[letter.toLowerCase()] ?? AXES.x!
        const step = new Quaternion().setFromAxisAngle(axis, angle(e[i] ?? 0))
        if (letter === letter.toLowerCase()) q.multiply(step)
        else q.premultiply(step)
      }
    } else if (source.axisangle) {
      const [x = 0, y = 0, z = 1, a = 0] = nums(source.axisangle)!
      q.setFromAxisAngle(new Vector3(x, y, z).normalize(), angle(a))
    } else if (source.xyaxes) {
      const [x0 = 1, x1 = 0, x2 = 0, y0 = 0, y1 = 1, y2 = 0] = nums(source.xyaxes)!
      const x = new Vector3(x0, x1, x2).normalize()
      const y = new Vector3(y0, y1, y2)
      y.addScaledVector(x, -x.dot(y)).normalize()
      const z = new Vector3().crossVectors(x, y)
      q.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z))
    } else if (source.zaxis) {
      q.setFromUnitVectors(new Vector3(0, 0, 1), new Vector3(...vec3(source.zaxis)).normalize())
    }
    return [q.x, q.y, q.z, q.w]
  }

  // Assets.
  const meshes: MjcfModel['meshes'] = {}
  const materials = new Map<string, Rgba>()
  for (const asset of kids(root, 'asset')) {
    for (const el of kids(asset, 'mesh')) {
      const { all } = effective(el, 'mesh', undefined)
      if (!all.file) continue
      const name = all.name ?? all.file.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
      meshes[name] = { file: all.file, scale: vec3(all.scale, [1, 1, 1]) }
    }
    for (const el of kids(asset, 'material')) {
      const { all } = effective(el, 'material', undefined)
      if (all.name) materials.set(all.name, (nums(all.rgba) ?? [1, 1, 1, 1]) as Rgba)
    }
  }

  let bodyCount = 0
  let jointCount = 0
  let geomCount = 0

  const parseJoint = (el: Element, childClass: string | undefined): MjcfJoint => {
    if (el.tagName === 'freejoint') {
      return { name: el.getAttribute('name') ?? `joint${jointCount++}`, type: 'free', axis: [0, 0, 1], pos: [0, 0, 0], range: null }
    }
    const { all } = effective(el, 'joint', childClass)
    const type = (all.type && Object.hasOwn(JOINT_TYPES, all.type) ? all.type : 'hinge') as JointType
    const [lo, hi] = nums(all.range) ?? []
    const limited = all.limited !== 'false' && lo !== undefined && hi !== undefined && lo < hi
    const toUnit = (v: number) => (type === 'hinge' ? angle(v) : v)
    return {
      name: all.name ?? `joint${jointCount++}`,
      type,
      axis: vec3(all.axis, [0, 0, 1]),
      pos: vec3(all.pos),
      range: limited ? [toUnit(lo), toUnit(hi)] : null,
    }
  }

  const parseGeom = (el: Element, childClass: string | undefined): MjcfGeom => {
    const { own, cls, all } = effective(el, 'geom', childClass)
    const type = (all.type && Object.hasOwn(GEOM_TYPES, all.type) ? all.type : all.mesh ? 'mesh' : 'sphere') as GeomType
    const fromto = nums(all.fromto)
    const rgba = (nums(own.rgba) ??
      (all.material ? materials.get(all.material) : undefined) ??
      nums(cls.rgba) ?? [0.5, 0.5, 0.5, 1]) as Rgba
    return {
      name: all.name ?? `geom${geomCount++}`,
      type,
      mesh: all.mesh,
      size: nums(all.size) ?? [],
      fromto: fromto && fromto.length === 6 ? fromto : undefined,
      pos: vec3(all.pos),
      quat: orientation(own, cls),
      rgba,
      group: Number(all.group ?? 0),
    }
  }

  const parseBody = (el: Element, inherited: string | undefined): MjcfBody => {
    const own = attrs(el)
    const childClass = own.childclass ?? inherited
    const body: MjcfBody = {
      name: own.name ?? `body${bodyCount++}`,
      pos: vec3(own.pos),
      quat: orientation(own, {}),
      joints: [],
      geoms: [],
      children: [],
      inertial: null,
    }
    for (const child of kids(el)) {
      if (child.tagName === 'joint' || child.tagName === 'freejoint') body.joints.push(parseJoint(child, childClass))
      else if (child.tagName === 'geom') body.geoms.push(parseGeom(child, childClass))
      else if (child.tagName === 'body') body.children.push(parseBody(child, childClass))
      else if (child.tagName === 'inertial') {
        const mass = Number(child.getAttribute('mass'))
        if (Number.isFinite(mass)) body.inertial = { mass, pos: vec3(child.getAttribute('pos') ?? undefined) }
      }
    }
    return body
  }

  const bodies = kids(root, 'worldbody').flatMap((wb) => kids(wb, 'body').map((b) => parseBody(b, undefined)))
  return { name: root.getAttribute('model') ?? '', meshDir, meshes, bodies }
}
