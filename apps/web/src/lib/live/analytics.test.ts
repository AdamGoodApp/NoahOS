import { describe, expect, it } from 'vitest'

import { LiveAnalytics } from './analytics'

const AUTO = 1
const MANUAL = 2

/** Feeds frames every 100 ms; `plan[i]` is [taskCycle, mode] for frame i. */
function run(a: LiveAnalytics, plan: [number, number][], t0 = 0, policy = 'sweep') {
  plan.forEach(([taskCycle, mode], i) => a.telemetry({ taskCycle, mode, policy, torque: [0], motorTempC: [30] }, t0 + i * 100))
}

const repeat = (n: number, frame: [number, number]) => Array.from({ length: n }, () => frame)

describe('LiveAnalytics cycle times', () => {
  it('times whole cycles and skips the one joined mid-way', () => {
    const a = new LiveAnalytics(AUTO)
    run(a, [...repeat(30, [4, AUTO]), ...repeat(80, [5, AUTO]), ...repeat(85, [6, AUTO]), [7, AUTO]])
    expect(a.snapshot().cycles).toEqual([
      { cycle: 5, seconds: 8 },
      { cycle: 6, seconds: 8.5 },
    ])
  })

  it('leaves out cycles interrupted by Manual hold', () => {
    const a = new LiveAnalytics(AUTO)
    run(a, [[1, AUTO], ...repeat(40, [2, AUTO]), ...repeat(20, [2, MANUAL]), ...repeat(40, [2, AUTO]), ...repeat(80, [3, AUTO]), [4, AUTO]])
    expect(a.snapshot().cycles).toEqual([{ cycle: 3, seconds: 8 }])
  })

  it('starts over when another policy plays', () => {
    const a = new LiveAnalytics(AUTO)
    run(a, [[1, AUTO], ...repeat(80, [2, AUTO]), [3, AUTO]])
    expect(a.snapshot().cycles).toEqual([{ cycle: 2, seconds: 8 }])
    // The walk restarts its clock at cycle 0: nothing to show until one whole walk cycle completes.
    run(a, [...repeat(100, [0, AUTO]), [1, AUTO]], 10_000, 'walk')
    expect(a.snapshot().cycles).toEqual([])
    run(a, [...repeat(99, [1, AUTO]), [2, AUTO]], 20_100, 'walk')
    expect(a.snapshot().cycles).toEqual([{ cycle: 1, seconds: 10 }])
  })

  it('keeps the peak |torque| per joint', () => {
    const a = new LiveAnalytics(AUTO)
    a.telemetry({ taskCycle: 0, mode: AUTO, policy: 'sweep', torque: [3, -9], motorTempC: [30] }, 0)
    a.telemetry({ taskCycle: 0, mode: AUTO, policy: 'sweep', torque: [-5, 2], motorTempC: [30] }, 100)
    expect(a.snapshot().peakTorque).toEqual([5, 9])
  })
})

describe('LiveAnalytics temperature history', () => {
  it('samples the hottest motor once per second and keeps two minutes', () => {
    const a = new LiveAnalytics(AUTO)
    for (let i = 0; i < 1300; i++) a.telemetry({ taskCycle: 0, mode: AUTO, policy: 'sweep', torque: [], motorTempC: [30, 30 + i / 10] }, i * 100)
    const temps = a.snapshot().hottestTemp
    expect(temps).toHaveLength(120)
    expect(temps.at(-1)).toBeCloseTo(30 + 1290 / 10)
    expect(temps[1]! - temps[0]!).toBeCloseTo(1)
  })
})
