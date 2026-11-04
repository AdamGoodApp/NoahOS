/** Per-session analytics for the live dock: torque peaks and task cycle times (STACK.md §7.4). Pure: time is passed in. */

export type CycleSample = {
  /** Task cycle number that completed. */
  cycle: number
  /** Wall-clock duration of the cycle, seconds. */
  seconds: number
}

export type LiveAnalyticsSnapshot = {
  /** Highest |torque| seen per joint this session (N·m or N), aligned with RobotSpec.joints. */
  peakTorque: number[]
  /** Last completed cycles of the selected policy, oldest first. Cycles interrupted by Manual hold or Stop are left out. */
  cycles: CycleSample[]
  /** Hottest modelled motor temperature (°C), one sample per second, last two minutes, oldest first. */
  hottestTemp: number[]
}

const MAX_CYCLES = 12
const TEMP_SAMPLES = 120
const TEMP_EVERY_MS = 1000

type Frame = { taskCycle: number; mode: number; policy: string; torque: number[]; motorTempC: number[] }

export class LiveAnalytics {
  private peak: number[] = []
  private cycles: CycleSample[] = []
  private cycle: number | null = null
  private cycleStart = 0
  /** False when the current cycle was paused or overridden, so its wall time says nothing about the task. */
  private cycleClean = false
  /** Policy whose cycles are being timed; another policy's cycles have another period. */
  private policy = ''
  private temps: number[] = []
  private tempAt = -Infinity

  /** `autoMode` is the Mode value of the running task (MODE_AUTO). */
  constructor(private readonly autoMode: number) {}

  reset() {
    this.peak = []
    this.cycles = []
    this.cycle = null
    this.cycleClean = false
    this.policy = ''
    this.temps = []
    this.tempAt = -Infinity
  }

  telemetry(t: Frame, now: number) {
    if (now - this.tempAt >= TEMP_EVERY_MS && t.motorTempC.length) {
      this.tempAt = now
      this.temps.push(Math.max(...t.motorTempC))
      if (this.temps.length > TEMP_SAMPLES) this.temps.shift()
    }
    for (let i = 0; i < t.torque.length; i++) {
      const v = Math.abs(t.torque[i]!)
      if (!(v <= (this.peak[i] ?? 0))) this.peak[i] = v
    }
    if (t.policy !== this.policy) {
      this.policy = t.policy
      this.cycles = []
      this.cycle = null
    }
    if (t.mode !== this.autoMode) this.cycleClean = false
    if (this.cycle === null) {
      this.cycle = t.taskCycle
      this.cycleStart = now
      this.cycleClean = false // joined mid-cycle
      return
    }
    if (t.taskCycle !== this.cycle) {
      if (this.cycleClean && t.taskCycle === this.cycle + 1) {
        this.cycles.push({ cycle: this.cycle, seconds: (now - this.cycleStart) / 1000 })
        if (this.cycles.length > MAX_CYCLES) this.cycles.shift()
      }
      this.cycle = t.taskCycle
      this.cycleStart = now
      this.cycleClean = t.mode === this.autoMode
    }
  }

  snapshot(): LiveAnalyticsSnapshot {
    return { peakTorque: [...this.peak], cycles: [...this.cycles], hottestTemp: [...this.temps] }
  }
}
