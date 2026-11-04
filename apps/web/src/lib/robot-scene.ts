// Imperative three.js scene for the Control page: renderer, orbit camera, axis gizmo, picking and joint drag.
import {
  AxesHelper,
  Box3,
  CanvasTexture,
  Color,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  LineSegments,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  PerspectiveCamera,
  Plane,
  Quaternion,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

import {
  ikChain,
  jointAimPoint,
  jointStats,
  setJoint,
  solveIk,
  type BuiltRobot,
  type JointNode,
  type JointStats,
} from './mjcf/build'

export type Tool = 'camera' | 'control' | 'move'
export type ViewPreset = 'iso' | 'front' | 'back' | 'left' | 'right' | 'top'
export type CameraState = { zoomPercent: number; preset: ViewPreset | null }

/** Where a joint sits on screen, for the control wheel overlay. */
export type JointProjection = {
  /** Pivot position in CSS pixels from the canvas's top-left corner. */
  x: number
  y: number
  /** +1 when a positive hinge rotation looks clockwise from the camera, -1 when anticlockwise. */
  sense: 1 | -1
  /** Screen direction (clockwise from up) from the pivot to the part's centre; null when it sits on the pivot. */
  aim: number | null
}

export type RobotSceneCallbacks = {
  onSelect(body: string | null): void
  onCameraChange(state: CameraState): void
  /** Joint values changed by an inverse-kinematics drag (Move joint tool or the pad with follow on). */
  onJointsDrag(values: Record<string, number>, phase: 'move' | 'end'): void
}

type IkDrag = {
  chain: JointNode[]
  effector: () => Vector3
  start: Vector3
  /** Plane the part moves in: through its start point, facing the camera. */
  right: Vector3
  up: Vector3
  normal: Vector3
  /** World distance of a full pad deflection (m). */
  padScale: number
}

const VIEW_DIRECTIONS: Record<ViewPreset, Vector3> = {
  iso: new Vector3(1, -1, 0.7).normalize(),
  front: new Vector3(1, 0, 0),
  back: new Vector3(-1, 0, 0),
  left: new Vector3(0, 1, 0),
  right: new Vector3(0, -1, 0),
  top: new Vector3(0.001, 0, 1).normalize(),
}

/** Carbon tokens: $layer-01, $support-error (red), $support-success (green), $interactive (blue). */
const BACKGROUND = 0xf4f4f4
const SELECTED = new Color('#0f62fe')
/** $support-error: the selected part while its joint sits on a limit. */
const LIMIT = new Color('#da1e28')
const BLACK = new Color(0x000000)
/** Below this on-screen distance from the pivot, the part's direction is too unstable to aim by. */
const AIM_MIN_PX = 6
/** A lever shorter than this (m) across the axis has no meaningful direction; the handle falls back to a dial. */
const AIM_MIN_LEVER_M = 0.005
const AXIS_COLORS = [new Color('#da1e28'), new Color('#24a148'), new Color('#0f62fe')] as const
const GIZMO_SIZE = 72
const GIZMO_MARGIN = 12
const CLICK_SLOP_PX = 5

function axisLabel(text: string, color: Color): Sprite {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  ctx.font = '600 48px "IBM Plex Sans", sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle = `#${color.getHexString()}`
  ctx.fillText(text, 32, 34)
  const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), depthTest: false }))
  sprite.scale.setScalar(0.6)
  return sprite
}

export class RobotScene {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new PerspectiveCamera(45, 1, 0.01, 100)
  private controls: OrbitControls
  private gizmoScene = new Scene()
  private gizmoCamera = new OrthographicCamera(-1.6, 1.6, 1.6, -1.6, 0.1, 10)
  private resizeObserver: ResizeObserver
  private frame = 0
  private robot: BuiltRobot | null = null
  private center = new Vector3()
  private radius = 0.5
  private fitDistance = 1
  /** Pixels at the bottom of the view covered by overlays (the live dock); framing keeps the robot above them. */
  private bottomInset = 0
  private preset: ViewPreset | null = 'iso'
  private lastCamera: CameraState = { zoomPercent: -1, preset: null }
  private selected: string | null = null
  private selectedAtLimit = false
  private tool: Tool = 'camera'
  private pointer: { id: number; x: number; y: number } | null = null
  private frameListeners = new Set<() => void>()
  private ik: IkDrag | null = null
  private raycaster = new Raycaster()
  private scratchQuat = new Quaternion()
  private viewDir = new Vector3()
  private scratchPivot = new Vector3()
  private scratchAxis = new Vector3()
  private scratchToCamera = new Vector3()
  private scratchNdc = new Vector3()
  private pointerNdc = new Vector2()
  private dragPlane = new Plane()
  private dragPoint = new Vector3()

  constructor(
    private container: HTMLElement,
    private callbacks: RobotSceneCallbacks,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setClearColor(BACKGROUND)
    const canvas = this.renderer.domElement
    canvas.style.display = 'block'
    canvas.style.touchAction = 'none'
    container.appendChild(canvas)

    // Registered before OrbitControls so grabbing a part with Move joint can stop the orbit.
    canvas.addEventListener('pointerdown', this.onPointerDown)
    canvas.addEventListener('pointermove', this.onPointerMove)
    canvas.addEventListener('pointerup', this.onPointerUp)
    canvas.addEventListener('pointercancel', this.onPointerUp)

    this.camera.up.set(0, 0, 1)
    this.controls = new OrbitControls(this.camera, canvas)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.screenSpacePanning = true

    this.scene.add(new HemisphereLight(0xffffff, 0xd9d9d9, 1.0))
    const key = new DirectionalLight(0xffffff, 2.0)
    key.position.set(3, -4, 6)
    const fill = new DirectionalLight(0xffffff, 0.8)
    fill.position.set(-4, 3, 2)
    this.scene.add(key, fill)
    const grid = new GridHelper(4, 40, 0xc6c6c6, 0xe0e0e0)
    grid.rotation.x = Math.PI / 2
    this.scene.add(grid)

    const axes = new AxesHelper(1)
    const [red, green, blue] = AXIS_COLORS
    axes.setColors(red, green, blue)
    this.gizmoScene.add(axes)
    AXIS_COLORS.forEach((color, i) => {
      const sprite = axisLabel('XYZ'.charAt(i), color)
      sprite.position.setComponent(i, 1.3)
      this.gizmoScene.add(sprite)
    })

    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()
    this.setView('iso')
    this.loop()
  }

  private resize() {
    const { clientWidth: w, clientHeight: h } = this.container
    if (!w || !h) return
    this.renderer.setSize(w, h)
    this.camera.aspect = w / h
    this.applyInset()
    this.updateFit()
  }

  /**
   * Shifts the projection centre up by half the covered height, so what the camera looks at sits in the middle of the
   * uncovered part of the view. Picking and IK use the same projection, so they stay aligned.
   */
  private applyInset() {
    const { clientWidth: w, clientHeight: h } = this.container
    const inset = Math.min(this.bottomInset, h * 0.8)
    if (inset > 0 && w && h) this.camera.setViewOffset(w, h, 0, inset / 2, w, h)
    else this.camera.clearViewOffset()
  }

  /** Overlay height (px) over the bottom of the view; reframes the robot to fit the uncovered part. */
  setBottomInset(px: number) {
    const inset = Math.max(0, Math.round(px))
    if (inset === this.bottomInset) return
    this.bottomInset = inset
    this.applyInset()
    this.updateFit()
    this.frameRobot()
  }

  /** Re-centres on the robot's current pose and backs off to fit it, keeping the viewing direction. */
  frameRobot() {
    if (this.robot) {
      this.robot.root.updateMatrixWorld(true)
      const box = new Box3().setFromObject(this.robot.root)
      if (!box.isEmpty()) {
        box.getCenter(this.center)
        this.radius = box.getSize(new Vector3()).length() / 2
        this.updateFit()
      }
    }
    const dir = this.camera.position.clone().sub(this.controls.target).normalize()
    this.controls.target.copy(this.center)
    this.camera.position.copy(this.center).addScaledVector(dir, this.fitDistance)
    this.camera.lookAt(this.center)
  }

  /** Distance at which the robot's bounding sphere fits the narrower of the two view angles. */
  private updateFit() {
    const fullV = (this.camera.fov * Math.PI) / 360
    const halfH = Math.atan(Math.tan(fullV) * this.camera.aspect)
    // Only the uncovered height counts vertically.
    const h = this.container.clientHeight
    const visible = h ? Math.max(h - Math.min(this.bottomInset, h * 0.8), 1) / h : 1
    const halfV = Math.atan(Math.tan(fullV) * visible)
    this.fitDistance = (this.radius / Math.sin(Math.min(halfV, halfH))) * 1.15
    this.camera.near = this.fitDistance / 100
    this.camera.far = this.fitDistance * 100
    this.camera.updateProjectionMatrix()
    this.controls.minDistance = this.fitDistance / 20
    this.controls.maxDistance = this.fitDistance * 20
  }

  private loop = () => {
    this.frame = requestAnimationFrame(this.loop)
    this.controls.update()
    const { clientWidth: w, clientHeight: h } = this.container
    this.renderer.setViewport(0, 0, w, h)
    this.renderer.render(this.scene, this.camera)

    const dir = this.viewDir.copy(this.camera.position).sub(this.controls.target).normalize()
    // Orbiting or panning away from a preset makes the view custom; zooming keeps it.
    if (
      this.preset &&
      (dir.dot(VIEW_DIRECTIONS[this.preset]) < 0.9999 || this.controls.target.distanceTo(this.center) > this.fitDistance * 1e-4)
    ) {
      this.preset = null
    }
    this.gizmoCamera.position.copy(dir).multiplyScalar(4)
    this.gizmoCamera.up.copy(this.camera.up)
    this.gizmoCamera.lookAt(0, 0, 0)
    const x = w - GIZMO_SIZE - GIZMO_MARGIN
    const y = h - GIZMO_SIZE - GIZMO_MARGIN
    this.renderer.autoClear = false
    this.renderer.clearDepth()
    this.renderer.setScissorTest(true)
    this.renderer.setScissor(x, y, GIZMO_SIZE, GIZMO_SIZE)
    this.renderer.setViewport(x, y, GIZMO_SIZE, GIZMO_SIZE)
    this.renderer.render(this.gizmoScene, this.gizmoCamera)
    this.renderer.setScissorTest(false)
    this.renderer.setViewport(0, 0, w, h)
    this.renderer.autoClear = true

    const zoomPercent = this.getZoomPercent()
    if (zoomPercent !== this.lastCamera.zoomPercent || this.preset !== this.lastCamera.preset) {
      this.lastCamera = { zoomPercent, preset: this.preset }
      this.callbacks.onCameraChange(this.lastCamera)
    }
    for (const listener of this.frameListeners) listener()
  }

  /** Calls `listener` after every rendered frame; returns the unsubscribe function. */
  onFrame(listener: () => void): () => void {
    this.frameListeners.add(listener)
    return () => this.frameListeners.delete(listener)
  }

  setRobot(robot: BuiltRobot | null) {
    if (this.robot) {
      this.scene.remove(this.robot.root)
      disposeTree(this.robot.root)
    }
    this.robot = robot
    this.selected = null
    if (!robot) return
    this.scene.add(robot.root)
    robot.root.updateMatrixWorld(true)
    const box = new Box3().setFromObject(robot.root)
    if (box.isEmpty()) box.set(new Vector3(-0.5, -0.5, 0), new Vector3(0.5, 0.5, 1))
    box.getCenter(this.center)
    this.radius = box.getSize(new Vector3()).length() / 2
    this.updateFit()
    this.setView('iso')
  }

  setView(preset: ViewPreset) {
    this.controls.target.copy(this.center)
    this.camera.position.copy(this.center).addScaledVector(VIEW_DIRECTIONS[preset], this.fitDistance)
    this.camera.lookAt(this.center)
    this.preset = preset
  }

  resetView() {
    this.setView('iso')
  }

  zoomBy(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target)
    const distance = Math.min(Math.max(offset.length() / factor, this.fitDistance / 20), this.fitDistance * 20)
    this.camera.position.copy(this.controls.target).addScaledVector(offset.normalize(), distance)
  }

  getZoomPercent() {
    return Math.round((this.fitDistance / this.camera.position.distanceTo(this.controls.target)) * 100)
  }

  setZoomPercent(percent: number) {
    const distance = this.camera.position.distanceTo(this.controls.target)
    this.zoomBy(distance / ((this.fitDistance * 100) / percent))
  }

  /** Highlights a part; `atLimit` turns the highlight from blue to red while its joint sits on a limit. */
  setSelected(body: string | null, atLimit = false) {
    if (this.selected === body && this.selectedAtLimit === atLimit) return
    this.highlight(this.selected, null)
    this.selected = body
    this.selectedAtLimit = atLimit
    this.highlight(body, atLimit ? LIMIT : SELECTED)
  }

  private highlight(body: string | null, color: Color | null) {
    const entry = body ? this.robot?.bodies.get(body) : undefined
    for (const mesh of entry?.meshes ?? []) {
      const material = mesh.material as MeshStandardMaterial
      material.emissive.copy(color ?? BLACK)
      material.emissiveIntensity = color ? 0.45 : 1
    }
  }

  /** Screen position of a joint's pivot and the on-screen sense of its rotation; null when off-screen or unknown. */
  projectJoint(name: string): JointProjection | null {
    const joint = this.robot?.joints.get(name)
    if (!joint) return null
    const pivot = joint.pivot.getWorldPosition(this.scratchPivot)
    const axis = this.scratchAxis.copy(joint.axis).applyQuaternion(joint.pivot.getWorldQuaternion(this.scratchQuat))
    const toCamera = this.scratchToCamera.copy(this.camera.position).sub(pivot)
    const ndc = this.scratchNdc.copy(pivot).project(this.camera)
    if (ndc.z > 1) return null
    const { clientWidth: w, clientHeight: h } = this.container
    const x = ((ndc.x + 1) / 2) * w
    const y = ((1 - ndc.y) / 2) * h
    let aim: number | null = null
    const point = this.robot ? jointAimPoint(this.robot, name) : null
    if (point) {
      // Only the part of the lever across the axis turns with the joint; mass along the axis (an arm above its
      // base yaw, a tool beyond a wrist roll) would pin the direction.
      const lever = point.sub(pivot)
      lever.addScaledVector(axis, -lever.dot(axis))
      if (lever.length() > AIM_MIN_LEVER_M) {
        const p = pivot.clone().add(lever).project(this.camera)
        const dx = ((p.x + 1) / 2) * w - x
        const dy = ((1 - p.y) / 2) * h - y
        if (Math.hypot(dx, dy) > AIM_MIN_PX) aim = Math.atan2(dx, -dy)
      }
    }
    return {
      x,
      y,
      // Right-hand rule: an axis pointing at the viewer turns anticlockwise on screen.
      sense: axis.dot(toCamera) > 0 ? -1 : 1,
      aim,
    }
  }

  getJointStats(name: string): JointStats | null {
    return this.robot ? jointStats(this.robot, name) : null
  }

  setTool(tool: Tool) {
    this.tool = tool
    this.updateCursor()
  }

  setJointValue(name: string, value: number) {
    if (this.robot) setJoint(this.robot, name, value)
  }

  getBodyWorldPosition(body: string): Vector3 | null {
    const entry = this.robot?.bodies.get(body)
    if (!entry) return null
    entry.object.updateWorldMatrix(true, false)
    return entry.object.getWorldPosition(new Vector3())
  }

  private updateCursor() {
    this.renderer.domElement.style.cursor =
      this.tool === 'camera' ? 'default' : this.tool === 'move' ? (this.ik ? 'grabbing' : 'grab') : 'pointer'
  }

  private ndc(clientX: number, clientY: number): Vector2 {
    const rect = this.renderer.domElement.getBoundingClientRect()
    return this.pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
  }

  /** The part under the pointer and the world point where the pointer meets it. */
  private pick(event: PointerEvent): { body: string; point: Vector3 } | null {
    if (!this.robot) return null
    this.raycaster.setFromCamera(this.ndc(event.clientX, event.clientY), this.camera)
    for (const hit of this.raycaster.intersectObjects(this.robot.root.children, true)) {
      const body = hit.object.userData.body as string | undefined
      if (body) return { body, point: hit.point }
    }
    return null
  }

  /**
   * Starts an inverse-kinematics drag of `body`: `grab` (the point the pointer caught, else the part's centre)
   * follows the pointer or pad, and every hinge and slide joint between the part and the robot's base (or
   * floating body) turns to get it there. Returns false when the part has no such joints.
   */
  ikBegin(body: string, grab?: Vector3): boolean {
    const robot = this.robot
    const node = robot?.bodies.get(body)
    if (!robot || !node) return false
    const chain = ikChain(robot, body)
    if (!chain.length) return false
    robot.root.updateMatrixWorld(true)
    let point = grab?.clone()
    if (!point) {
      const box = new Box3()
      for (const mesh of node.meshes) box.expandByObject(mesh)
      point = box.isEmpty() ? node.frame.getWorldPosition(new Vector3()) : box.getCenter(new Vector3())
    }
    const local = node.frame.worldToLocal(point)
    const effector = () => node.frame.localToWorld(local.clone())
    const start = effector()
    const reach = Math.max(...chain.map((j) => j.pivot.getWorldPosition(new Vector3()).distanceTo(start)))
    const normal = this.camera.getWorldDirection(new Vector3())
    this.ik = {
      chain,
      effector,
      start,
      right: new Vector3().crossVectors(normal, this.camera.up).normalize(),
      up: this.camera.up.clone().projectOnPlane(normal).normalize(),
      normal,
      padScale: Math.max(reach * 0.5, 0.05),
    }
    this.updateCursor()
    return true
  }

  /** Moves the dragged part by a pad deflection (u right, v down; ±1 at the pad's edge) in the screen plane. */
  ikMovePad(u: number, v: number) {
    const ik = this.ik
    if (!ik) return
    const target = ik.start.clone().addScaledVector(ik.right, u * ik.padScale).addScaledVector(ik.up, -v * ik.padScale)
    this.ikSolve(target, 'move')
  }

  ikEnd() {
    if (!this.ik) return
    this.callbacks.onJointsDrag(this.ikValues(), 'end')
    this.ik = null
    this.updateCursor()
  }

  private ikValues(): Record<string, number> {
    return Object.fromEntries((this.ik?.chain ?? []).map((j) => [j.name, j.value]))
  }

  private ikSolve(target: Vector3, phase: 'move' | 'end') {
    if (!this.robot || !this.ik) return
    solveIk(this.robot, this.ik.chain, this.ik.effector, target)
    this.callbacks.onJointsDrag(this.ikValues(), phase)
  }

  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 && event.pointerType === 'mouse') return
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY }
    if (this.tool !== 'move') return
    // Move joint: grabbing a part drags it, and the joints below it follow; empty space still orbits.
    const hit = this.pick(event)
    if (!hit) return
    this.callbacks.onSelect(hit.body)
    if (!this.ikBegin(hit.body, hit.point)) return
    this.controls.enabled = false
    this.renderer.domElement.setPointerCapture(event.pointerId)
  }

  private onPointerMove = (event: PointerEvent) => {
    const ik = this.ik
    if (!ik || this.pointer?.id !== event.pointerId) return
    this.raycaster.setFromCamera(this.ndc(event.clientX, event.clientY), this.camera)
    this.dragPlane.setFromNormalAndCoplanarPoint(ik.normal, ik.start)
    const target = this.raycaster.ray.intersectPlane(this.dragPlane, this.dragPoint)
    if (target) this.ikSolve(target, 'move')
  }

  /** A click (not an orbit drag) with the Control or Move tool picks the part under the pointer. */
  private onPointerUp = (event: PointerEvent) => {
    const pointer = this.pointer
    if (!pointer || pointer.id !== event.pointerId) return
    this.pointer = null
    if (this.ik) {
      this.ikEnd()
      this.controls.enabled = true
      return
    }
    const moved = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y)
    if (this.tool !== 'camera' && moved < CLICK_SLOP_PX) this.callbacks.onSelect(this.pick(event)?.body ?? null)
  }

  dispose() {
    cancelAnimationFrame(this.frame)
    this.resizeObserver.disconnect()
    this.controls.dispose()
    const canvas = this.renderer.domElement
    canvas.removeEventListener('pointerdown', this.onPointerDown)
    canvas.removeEventListener('pointermove', this.onPointerMove)
    canvas.removeEventListener('pointerup', this.onPointerUp)
    canvas.removeEventListener('pointercancel', this.onPointerUp)
    disposeTree(this.scene)
    disposeTree(this.gizmoScene)
    this.renderer.dispose()
    canvas.remove()
  }
}

function disposeTree(root: Object3D) {
  root.traverse((o) => {
    if (!(o instanceof Mesh || o instanceof Sprite || o instanceof LineSegments)) return
    o.geometry.dispose()
    const materials: Material[] = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of materials) {
      ;(m as MeshStandardMaterial).map?.dispose()
      m.dispose()
    }
  })
}
