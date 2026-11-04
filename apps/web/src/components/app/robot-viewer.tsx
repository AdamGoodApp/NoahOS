// Client-only: imported with React.lazy inside <ClientOnly>, never rendered on the server.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'

import { baseValues, buildRobot, loadMeshAssets, type BuiltRobot, type JointStats } from '@/lib/mjcf/build'
import { parseMjcf } from '@/lib/mjcf/parse'
import { RobotScene, type CameraState, type Tool, type ViewPreset } from '@/lib/robot-scene'
import type { JointInfo, RobotInfo } from './control-state'
import type { Aim } from './joint-control'
import { JointWheel } from './joint-wheel'

export type RobotViewerHandle = {
  zoomBy(factor: number): void
  setZoomPercent(percent: number): void
  setView(preset: ViewPreset): void
  resetView(): void
  /** Fit the robot's current pose in the uncovered part of the view, keeping the viewing direction. */
  frameRobot(): void
  /** Inverse-kinematics drag from the pad: begin returns false when the part has no joints to follow. */
  ikBegin(body: string): boolean
  ikMovePad(u: number, v: number): void
  ikEnd(): void
}

export type RobotViewerProps = {
  modelUrl: string
  jointValues: Record<string, number>
  /** Height (px) of overlays covering the bottom of the view; the robot is framed above them. */
  bottomInset?: number
  selectedBody: string | null
  /** Turns the selected part's highlight red while its active joint sits on a limit. */
  selectedAtLimit: boolean
  /** Joint shown with the control wheel (Control tool); null hides the wheel. */
  controlJoint: JointInfo | null
  /** Joint whose static load is reported through onJointStats (Control and Move tools). */
  statsJoint: string | null
  tool: Tool
  onModelLoaded(info: RobotInfo): void
  onLoadProgress(loaded: number, total: number): void
  onLoadError(message: string): void
  onSelect(body: string | null): void
  onJointDrag(joint: string, value: number, phase: 'move' | 'end'): void
  onJointsDrag(values: Record<string, number>, phase: 'move' | 'end'): void
  onCameraChange(state: CameraState): void
  onSelectedPosition(position: [number, number, number] | null): void
  onJointStats(stats: JointStats | null): void
  /** Where the control joint's part points on screen, so the pad shows and turns it like the wheel. */
  onControlAim(aim: Aim): void
}

function describe(robot: BuiltRobot): RobotInfo {
  const joints: JointInfo[] = robot.jointOrder.flatMap((name) => {
    const j = robot.joints.get(name)!
    if (j.type !== 'hinge' && j.type !== 'slide') return []
    return [{ name, body: j.body, type: j.type, axis: [j.axis.x, j.axis.y, j.axis.z], range: j.range }]
  })
  return { joints, baseValues: baseValues(robot) }
}

const RobotViewer = forwardRef<RobotViewerHandle, RobotViewerProps>(function RobotViewer(props, ref) {
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<RobotScene | null>(null)
  const [scene, setScene] = useState<RobotScene | null>(null)
  const [loaded, setLoaded] = useState(false)
  const robotRef = useRef<BuiltRobot | null>(null)
  const appliedRef = useRef<Record<string, number>>({})
  // Latest callbacks, so the scene and loader never call stale closures.
  const propsRef = useRef(props)
  propsRef.current = props

  useImperativeHandle(ref, () => ({
    zoomBy: (f) => sceneRef.current?.zoomBy(f),
    setZoomPercent: (p) => sceneRef.current?.setZoomPercent(p),
    setView: (p) => sceneRef.current?.setView(p),
    resetView: () => sceneRef.current?.resetView(),
    frameRobot: () => sceneRef.current?.frameRobot(),
    ikBegin: (body) => sceneRef.current?.ikBegin(body) ?? false,
    ikMovePad: (u, v) => sceneRef.current?.ikMovePad(u, v),
    ikEnd: () => sceneRef.current?.ikEnd(),
  }))

  useEffect(() => {
    const created = new RobotScene(containerRef.current!, {
      onSelect: (b) => propsRef.current.onSelect(b),
      onCameraChange: (c) => propsRef.current.onCameraChange(c),
      onJointsDrag: (values, phase) => propsRef.current.onJointsDrag(values, phase),
    })
    sceneRef.current = created
    setScene(created)
    return () => {
      created.dispose()
      sceneRef.current = null
    }
  }, [])

  const { modelUrl } = props
  useEffect(() => {
    let cancelled = false
    setLoaded(false)
    const baseUrl = modelUrl.slice(0, modelUrl.lastIndexOf('/'))
    const fail = (message: string) => !cancelled && propsRef.current.onLoadError(message)
    ;(async () => {
      const res = await fetch(modelUrl)
      const isXml = res.ok && !(res.headers.get('content-type') ?? '').includes('text/html')
      if (!isXml) {
        return fail(
          import.meta.env.DEV
            ? 'Model files not found. Run "pnpm models:fetch" in apps/web, then reload.'
            : "This robot's 3D model isn't available. Reload, or try again later.",
        )
      }
      const model = await parseMjcf(await res.text(), async (file) => {
        const r = await fetch(`${baseUrl}/${file}`)
        if (!r.ok) throw new Error(file)
        return r.text()
      })
      if (cancelled) return
      let assets
      try {
        assets = await loadMeshAssets(model, baseUrl, (loaded, total) => {
          if (!cancelled) propsRef.current.onLoadProgress(loaded, total)
        })
      } catch (error) {
        return fail(`Could not load ${(error as Error).message}`)
      }
      if (cancelled) return
      const robot = buildRobot(model, assets)
      robotRef.current = robot
      appliedRef.current = {}
      sceneRef.current?.setRobot(robot)
      propsRef.current.onModelLoaded(describe(robot))
      setLoaded(true)
    })().catch((error: Error) => fail(error.message))
    return () => {
      cancelled = true
    }
  }, [modelUrl])

  const { jointValues, selectedBody, selectedAtLimit, controlJoint, tool, bottomInset = 0 } = props
  useEffect(() => {
    if (loaded) sceneRef.current?.setBottomInset(bottomInset)
  }, [bottomInset, loaded])
  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || !robotRef.current) return
    for (const [name, value] of Object.entries(jointValues)) {
      if (appliedRef.current[name] === value) continue
      scene.setJointValue(name, value)
      appliedRef.current[name] = value
    }
  }, [jointValues])

  useEffect(() => sceneRef.current?.setSelected(selectedBody, selectedAtLimit), [selectedBody, selectedAtLimit])
  useEffect(() => sceneRef.current?.setTool(tool), [tool])

  useEffect(() => {
    const p = selectedBody ? sceneRef.current?.getBodyWorldPosition(selectedBody) : null
    propsRef.current.onSelectedPosition(p ? [p.x, p.y, p.z] : null)
  }, [jointValues, selectedBody])

  const { statsJoint } = props
  useEffect(() => {
    propsRef.current.onJointStats(statsJoint && loaded ? (sceneRef.current?.getJointStats(statsJoint) ?? null) : null)
  }, [jointValues, statsJoint, loaded])

  return (
    <div ref={containerRef} className="control-stage__canvas">
      {scene && loaded && controlJoint && (
        <JointWheel
          scene={scene}
          joint={controlJoint}
          value={jointValues[controlJoint.name] ?? 0}
          atLimit={selectedAtLimit}
          onChange={(value, phase) => propsRef.current.onJointDrag(controlJoint.name, value, phase)}
          onAim={(aim) => propsRef.current.onControlAim(aim)}
        />
      )}
    </div>
  )
})

export default RobotViewer
