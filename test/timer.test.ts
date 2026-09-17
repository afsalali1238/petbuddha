import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PhaseTimer, type TimerHost } from '@main/timer'

describe('PhaseTimer', () => {
  let clock: { ms: number }
  let host: TimerHost & { ticks: number[]; dones: number[] }
  let scheduleFn: (fn: () => void, ms: number) => () => void
  let pulses: Array<() => void>

  beforeEach(() => {
    clock = { ms: 1_000_000 }
    pulses = []
    scheduleFn = (fn) => {
      pulses.push(fn)
      return () => {
        pulses = pulses.filter((p) => p !== fn)
      }
    }
    host = {
      now: () => clock.ms,
      onTick: vi.fn(({ remainingMs }) => {
        host.ticks.push(remainingMs)
      }),
      onDone: vi.fn(({ now }) => {
        host.dones.push(now)
      }),
      schedule: (fn, ms) => scheduleFn(fn, ms),
      ticks: [],
      dones: []
    }
  })

  function pulse(): void {
    for (const p of [...pulses]) p()
  }

  it('ticks with remaining time and never transitions on its own', () => {
    const timer = new PhaseTimer(host)
    timer.arm(clock.ms + 1000) // arming paints once immediately
    clock.ms += 250
    pulse()
    expect(host.ticks).toEqual([1000, 750])
    expect(host.dones).toEqual([])
  })

  it('fires done exactly once when the end passes', () => {
    const timer = new PhaseTimer(host)
    timer.arm(clock.ms + 300)
    clock.ms += 400
    pulse()
    pulse()
    pulse()
    expect(host.dones).toHaveLength(1)
    expect(host.dones[0]).toBe(clock.ms)
  })

  it('reports how far past the end we overshot', () => {
    let overshoot = -1
    host.onDone = ({ overshootMs }) => {
      overshoot = overshootMs
    }
    const timer = new PhaseTimer(host)
    timer.arm(clock.ms + 1000)
    clock.ms += 1250 // 250 ms late
    pulse()
    expect(overshoot).toBe(250)
  })

  it('reconciles after sleep: a phase that ended while away fires once', () => {
    const timer = new PhaseTimer(host)
    timer.arm(clock.ms + 5000)
    // machine sleeps: no pulses run for an hour
    clock.ms += 3_600_000
    timer.reconcile()
    expect(host.dones).toHaveLength(1)
    // further reconciles are no-ops
    timer.reconcile()
    timer.reconcile()
    expect(host.dones).toHaveLength(1)
  })

  it('does not reconcile an unfinished phase', () => {
    const timer = new PhaseTimer(host)
    timer.arm(clock.ms + 60_000)
    clock.ms += 10_000
    timer.reconcile()
    expect(host.dones).toHaveLength(0)
    expect(timer.isArmed()).toBe(true)
  })

  it('pauses and resumes by re-arming with the recomputed end time', () => {
    const timer = new PhaseTimer(host)
    timer.arm(clock.ms + 25 * 60_000)
    clock.ms += 60_000
    pulse()
    const remaining = 24 * 60_000

    timer.disarm() // pause
    expect(timer.isArmed()).toBe(false)
    clock.ms += 600_000 // ten minutes away at lunch
    pulse()
    expect(host.dones).toHaveLength(0)

    timer.arm(clock.ms + remaining) // resume
    clock.ms += remaining - 100
    pulse()
    expect(host.dones).toHaveLength(0)
    clock.ms += 100
    pulse()
    expect(host.dones).toHaveLength(1)
  })

  it('re-arming resets the fired guard', () => {
    const timer = new PhaseTimer(host)
    timer.arm(clock.ms + 100)
    clock.ms += 200
    pulse()
    expect(host.dones).toHaveLength(1)
    timer.arm(clock.ms + 100)
    clock.ms += 200
    pulse()
    expect(host.dones).toHaveLength(2)
  })

  it('disarming stops the scheduler', () => {
    const timer = new PhaseTimer(host)
    timer.arm(clock.ms + 1000)
    expect(pulses).toHaveLength(1)
    timer.disarm()
    expect(pulses).toHaveLength(0)
    clock.ms += 5000
    pulse()
    expect(host.dones).toHaveLength(0)
  })

  it('arming with null emits a single frozen tick and stops', () => {
    const timer = new PhaseTimer(host)
    timer.arm(null)
    expect(host.ticks).toEqual([0])
    expect(pulses).toHaveLength(0)
  })

  it('poke redraws without arming', () => {
    const timer = new PhaseTimer(host)
    timer.poke()
    expect(host.ticks).toHaveLength(0)
    timer.arm(clock.ms + 4000)
    host.ticks.length = 0
    timer.poke()
    expect(host.ticks).toEqual([4000])
    expect(host.dones).toHaveLength(0)
  })

  it('a 25 minute focus survives a mid-session sleep and lands within a second', () => {
    const timer = new PhaseTimer(host)
    const focusEnd = clock.ms + 25 * 60_000
    timer.arm(focusEnd)
    clock.ms += 10 * 60_000
    pulse()
    clock.ms += 600_000 // 10 min sleep, no pulses
    timer.reconcile()
    clock.ms += 5 * 60_000 - 800
    pulse()
    expect(host.dones).toHaveLength(0)
    clock.ms += 800
    pulse()
    expect(host.dones).toHaveLength(1)
    expect(host.dones[0] - focusEnd).toBeLessThanOrEqual(1000)
  })
})
