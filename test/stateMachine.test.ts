import { describe, expect, it } from 'vitest'
import {
  canPause,
  computeBloomStage,
  createInitialState,
  isTimedPhase,
  next,
  type MachineEvent,
  type MachineState,
  type Phase
} from '@main/stateMachine'

const NOW = 1_700_000_000_000
const FOCUS = 25 * 60_000
const SHORT = 5 * 60_000
const LONG = 15 * 60_000

const PHASES: Phase[] = ['idle', 'focus', 'waking', 'walkingOut', 'break', 'returning', 'ready']

function timedState(phase: Phase, over: Partial<MachineState> = {}): MachineState {
  return createInitialState({
    phase,
    paused: false,
    endsAt: isTimedPhase(phase) ? NOW + FOCUS : null,
    remainingMs: isTimedPhase(phase) ? FOCUS : null,
    ...over
  })
}

function ev(type: MachineEvent['type'], extra: Record<string, unknown> = {}): MachineEvent {
  return { type, now: NOW, focusMs: FOCUS, breakMs: SHORT, ...extra } as MachineEvent
}

function assertInvariants(s: MachineState): void {
  expect(PHASES).toContain(s.phase)
  expect(s.distractionLevel).toBeGreaterThanOrEqual(0)
  expect(s.distractionLevel).toBeLessThanOrEqual(3)
  expect(s.bloomStage).toBeGreaterThanOrEqual(0)
  expect(s.bloomStage).toBeLessThanOrEqual(4)
  expect(s.sessionIndex).toBeGreaterThanOrEqual(0)
  if (s.paused) {
    expect(s.endsAt).toBeNull()
    expect(canPause(s.phase)).toBe(true)
  }
  if (!isTimedPhase(s.phase)) {
    expect(s.endsAt).toBeNull()
  }
  if (s.endsAt != null) {
    expect(s.remainingMs).toBe(Math.max(0, s.endsAt - NOW))
  }
}

describe('state machine — full matrix', () => {
  const events: Array<MachineEvent['type']> = [
    'START',
    'PAUSE',
    'RESUME',
    'TICK',
    'TIMER_DONE',
    'ANIM_DONE',
    'SKIP',
    'RESET',
    'DISTRACTED',
    'REFOCUSED'
  ]

  for (const phase of PHASES) {
    for (const paused of [false, true]) {
      for (const type of events) {
        it(`${type} from ${phase}${paused ? ' (paused)' : ''} keeps invariants`, () => {
          // A paused state never holds an endsAt: the clock is frozen instead.
          const from = timedState(
            phase,
            paused && canPause(phase) ? { paused: true, endsAt: null, remainingMs: FOCUS } : {}
          )
          const to = next(from, ev(type))
          assertInvariants(to)
        })
      }
    }
  }

  it('never mutates the input state', () => {
    const from = timedState('focus')
    const snapshot = structuredClone(from)
    next(from, ev('TIMER_DONE'))
    next(from, ev('PAUSE'))
    next(from, ev('SKIP'))
    expect(from).toEqual(snapshot)
  })

  it('ignores unknown events', () => {
    const from = timedState('focus')
    expect(next(from, { type: 'NOPE' } as unknown as MachineEvent)).toBe(from)
  })
})

describe('the full loop', () => {
  it('runs focus -> waking -> walkingOut -> break -> returning -> ready -> focus', () => {
    let s = timedState('idle')

    s = next(s, ev('START'))
    expect(s.phase).toBe('focus')
    expect(s.endsAt).toBe(NOW + FOCUS)
    expect(s.remainingMs).toBe(FOCUS)

    // walking the clock forward only redraws, it never transitions
    s = next(s, { type: 'TICK', now: NOW + FOCUS - 1000 })
    expect(s.phase).toBe('focus')
    expect(s.remainingMs).toBe(1000)

    s = next(s, ev('TIMER_DONE'))
    expect(s.phase).toBe('waking')
    expect(s.sessionIndex).toBe(1)
    expect(s.endsAt).toBeNull()

    s = next(s, ev('ANIM_DONE'))
    expect(s.phase).toBe('walkingOut')

    s = next(s, ev('ANIM_DONE', { breakMs: SHORT }))
    expect(s.phase).toBe('break')
    expect(s.endsAt).toBe(NOW + SHORT)

    s = next(s, { type: 'TIMER_DONE', now: NOW + SHORT })
    expect(s.phase).toBe('returning')

    s = next(s, ev('ANIM_DONE'))
    expect(s.phase).toBe('ready')

    s = next(s, ev('START'))
    expect(s.phase).toBe('focus')
    expect(s.endsAt).toBe(NOW + FOCUS)
  })

  it('never lets a tick cross a phase boundary on its own', () => {
    let s = timedState('focus', { endsAt: NOW + 1000 })
    s = next(s, { type: 'TICK', now: NOW + 60_000 })
    expect(s.phase).toBe('focus')
    expect(s.remainingMs).toBe(0)
  })
})

describe('pause is a flag, not a phase', () => {
  it('pauses and resumes focus with exact remaining time', () => {
    let s = timedState('focus', { endsAt: NOW + FOCUS })
    s = next(s, { type: 'TICK', now: NOW + 60_000 })
    s = next(s, { type: 'PAUSE', now: NOW + 60_000 })
    expect(s.phase).toBe('focus')
    expect(s.paused).toBe(true)
    expect(s.endsAt).toBeNull()
    expect(s.remainingMs).toBe(FOCUS - 60_000)

    // time passes while paused; remaining must not move
    s = next(s, { type: 'TICK', now: NOW + 500_000 })
    expect(s.remainingMs).toBe(FOCUS - 60_000)

    s = next(s, { type: 'RESUME', now: NOW + 500_000 })
    expect(s.paused).toBe(false)
    expect(s.endsAt).toBe(NOW + 500_000 + (FOCUS - 60_000))
  })

  it('pauses and resumes a break', () => {
    let s = timedState('break', { endsAt: NOW + SHORT, remainingMs: SHORT })
    s = next(s, ev('PAUSE'))
    expect(s.paused).toBe(true)
    expect(s.remainingMs).toBe(SHORT)
    s = next(s, ev('RESUME'))
    expect(s.endsAt).toBe(NOW + SHORT)
  })

  it('ignores pause outside focus/break', () => {
    for (const phase of PHASES.filter((p) => p !== 'focus' && p !== 'break')) {
      const s = timedState(phase)
      expect(next(s, ev('PAUSE')).paused).toBe(false)
    }
  })

  it('ignores resume when not paused', () => {
    const s = timedState('focus')
    expect(next(s, ev('RESUME'))).toBe(s)
  })

  it('resuming with no time left falls through to the end transition', () => {
    const s = timedState('focus', { paused: true, endsAt: null, remainingMs: 0 })
    const after = next(s, ev('RESUME'))
    expect(after.phase).toBe('waking')
    expect(after.sessionIndex).toBe(1)
  })
})

describe('skip performs the end transition immediately', () => {
  it('from focus', () => {
    const s = next(timedState('focus'), ev('SKIP'))
    expect(s.phase).toBe('waking')
    expect(s.sessionIndex).toBe(1)
  })

  it('from waking', () => {
    const s = next(timedState('waking', { sessionIndex: 1 }), ev('SKIP'))
    expect(s.phase).toBe('walkingOut')
    expect(s.sessionIndex).toBe(1)
  })

  it('from walkingOut starts the break', () => {
    const s = next(timedState('walkingOut', { sessionIndex: 1 }), ev('SKIP', { breakMs: LONG }))
    expect(s.phase).toBe('break')
    expect(s.endsAt).toBe(NOW + LONG)
  })

  it('from break', () => {
    const s = next(timedState('break'), ev('SKIP'))
    expect(s.phase).toBe('returning')
  })

  it('from returning', () => {
    const s = next(timedState('returning'), ev('SKIP'))
    expect(s.phase).toBe('ready')
  })

  it('is a no-op from idle and ready', () => {
    expect(next(timedState('idle'), ev('SKIP')).phase).toBe('idle')
    expect(next(timedState('ready'), ev('SKIP')).phase).toBe('ready')
  })
})

describe('reset', () => {
  it('returns every phase to idle', () => {
    for (const phase of PHASES) {
      const s = next(
        timedState(phase, { paused: canPause(phase), distractionLevel: 2 }),
        ev('RESET')
      )
      expect(s.phase).toBe('idle')
      expect(s.paused).toBe(false)
      expect(s.endsAt).toBeNull()
      expect(s.distractionLevel).toBe(0)
    }
  })

  it('keeps accumulated session progress', () => {
    const s = next(timedState('break', { sessionIndex: 3, bloomStage: 3 }), ev('RESET'))
    expect(s.sessionIndex).toBe(3)
    expect(s.bloomStage).toBe(3)
  })
})

describe('start', () => {
  it('only starts from idle and ready', () => {
    expect(next(timedState('idle'), ev('START')).phase).toBe('focus')
    expect(next(timedState('ready'), ev('START')).phase).toBe('focus')
    for (const phase of PHASES.filter((p) => p !== 'idle' && p !== 'ready')) {
      expect(next(timedState(phase), ev('START')).phase).toBe(phase)
    }
  })

  it('clears any lingering distraction level', () => {
    const s = next(timedState('ready', { distractionLevel: 3 }), ev('START'))
    expect(s.distractionLevel).toBe(0)
  })
})

describe('distraction escalation', () => {
  it('escalates only during unpaused focus and caps at 3', () => {
    let s = timedState('focus')
    s = next(s, ev('DISTRACTED'))
    expect(s.distractionLevel).toBe(1)
    s = next(s, ev('DISTRACTED'))
    s = next(s, ev('DISTRACTED'))
    s = next(s, ev('DISTRACTED'))
    expect(s.distractionLevel).toBe(3)
  })

  it('does not escalate while paused or outside focus', () => {
    expect(next(timedState('focus', { paused: true }), ev('DISTRACTED')).distractionLevel).toBe(0)
    for (const phase of PHASES.filter((p) => p !== 'focus')) {
      expect(next(timedState(phase), ev('DISTRACTED')).distractionLevel).toBe(0)
    }
  })

  it('refocusing resets the level', () => {
    const s = next(timedState('focus', { distractionLevel: 3 }), ev('REFOCUSED'))
    expect(s.distractionLevel).toBe(0)
  })
})

describe('bloom stages', () => {
  it('stage 4 lands exactly on the long break for classic (every 4)', () => {
    expect([1, 2, 3, 4].map((i) => computeBloomStage(i, 4))).toEqual([1, 2, 3, 4])
  })

  it('stage 4 lands on the long break for monk mode (every 2)', () => {
    expect(computeBloomStage(1, 2)).toBe(2)
    expect(computeBloomStage(2, 2)).toBe(4)
  })

  it('never exceeds 4 and starts at 0', () => {
    expect(computeBloomStage(0, 4)).toBe(0)
    expect(computeBloomStage(9, 4)).toBe(4)
  })

  it('advances as sessions complete', () => {
    let s = timedState('idle')
    for (let i = 1; i <= 4; i++) {
      s = next(s, ev('START'))
      s = next(s, ev('TIMER_DONE'))
      expect(s.sessionIndex).toBe(i)
      expect(s.bloomStage).toBe(i as 0 | 1 | 2 | 3 | 4)
      s = next(s, ev('ANIM_DONE'))
      s = next(s, ev('ANIM_DONE', { breakMs: SHORT }))
      s = next(s, ev('TIMER_DONE'))
      s = next(s, ev('ANIM_DONE'))
      expect(s.phase).toBe('ready')
    }
  })
})

describe('RESTORE from a cold boot', () => {
  it('resumes an in-flight focus exactly', () => {
    const s = next(timedState('idle'), {
      type: 'RESTORE',
      now: NOW,
      saved: {
        phase: 'focus',
        endsAt: NOW + 60_000,
        pausedAt: null,
        pausedRemaining: null,
        sessionIndex: 2
      }
    })
    expect(s.phase).toBe('focus')
    expect(s.paused).toBe(false)
    expect(s.endsAt).toBe(NOW + 60_000)
    expect(s.remainingMs).toBe(60_000)
    expect(s.sessionIndex).toBe(2)
    expect(s.bloomStage).toBe(2)
  })

  it('resumes an in-flight break exactly', () => {
    const s = next(timedState('idle'), {
      type: 'RESTORE',
      now: NOW,
      saved: {
        phase: 'break',
        endsAt: NOW + 30_000,
        pausedAt: null,
        pausedRemaining: null,
        sessionIndex: 4
      }
    })
    expect(s.phase).toBe('break')
    expect(s.endsAt).toBe(NOW + 30_000)
    expect(s.sessionIndex).toBe(4)
    expect(s.bloomStage).toBe(4)
  })

  it('counts a focus that expired while away and lands in ready', () => {
    const s = next(timedState('idle'), {
      type: 'RESTORE',
      now: NOW,
      saved: {
        phase: 'focus',
        endsAt: NOW - 60_000,
        pausedAt: null,
        pausedRemaining: null,
        sessionIndex: 2
      }
    })
    expect(s.phase).toBe('ready')
    expect(s.sessionIndex).toBe(3)
    expect(s.bloomStage).toBe(3)
    expect(s.endsAt).toBeNull()
  })

  it('never auto-starts a break after a break expired while away', () => {
    const s = next(timedState('idle'), {
      type: 'RESTORE',
      now: NOW,
      saved: {
        phase: 'break',
        endsAt: NOW - 10_000,
        pausedAt: null,
        pausedRemaining: null,
        sessionIndex: 4
      }
    })
    expect(s.phase).toBe('ready')
    expect(s.sessionIndex).toBe(4)
  })

  it('restores a paused session as paused with its frozen remaining time', () => {
    const s = next(timedState('idle'), {
      type: 'RESTORE',
      now: NOW,
      saved: {
        phase: 'focus',
        endsAt: null,
        pausedAt: NOW - 5_000,
        pausedRemaining: 123_000,
        sessionIndex: 1
      }
    })
    expect(s.phase).toBe('focus')
    expect(s.paused).toBe(true)
    expect(s.endsAt).toBeNull()
    expect(s.remainingMs).toBe(123_000)
  })

  it('lands mid-animation phases in ready', () => {
    for (const phase of ['waking', 'walkingOut', 'returning'] as const) {
      const s = next(timedState('idle'), {
        type: 'RESTORE',
        now: NOW,
        saved: { phase, endsAt: null, pausedAt: null, pausedRemaining: null, sessionIndex: 1 }
      })
      expect(s.phase).toBe('ready')
      expect(s.sessionIndex).toBe(1)
    }
  })

  it('restores idle and ready as themselves, timeless', () => {
    for (const phase of ['idle', 'ready'] as const) {
      const s = next(timedState('idle'), {
        type: 'RESTORE',
        now: NOW,
        saved: { phase, endsAt: null, pausedAt: null, pausedRemaining: null, sessionIndex: 5 }
      })
      expect(s.phase).toBe(phase)
      expect(s.endsAt).toBeNull()
      expect(s.remainingMs).toBeNull()
    }
  })
})
