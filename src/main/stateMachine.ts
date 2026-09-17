import type { PersistedSession } from '@shared/types'

/**
 * Pure Pomodoro state machine (§2.1, §7.3).
 *
 * Rules of the file:
 *  - no Electron imports, no I/O, no clock: `now` is always injected.
 *  - `next()` never mutates its input and never throws on an odd event.
 *  - Pause is a flag on Focus/Break, never a phase.
 *  - Skip performs the current phase's end transition immediately.
 */

export type Phase = 'idle' | 'focus' | 'waking' | 'walkingOut' | 'break' | 'returning' | 'ready'

export interface MachineState {
  phase: Phase
  paused: boolean
  endsAt: number | null
  remainingMs: number | null
  sessionIndex: number
  longEveryN: number
  displayId: number
  petPos: { x: number; y: number }
  scale: number
  bloomStage: 0 | 1 | 2 | 3 | 4
  distractionLevel: 0 | 1 | 2 | 3
}

export type MachineEvent =
  | { type: 'START'; now: number; focusMs: number }
  | { type: 'PAUSE'; now: number }
  | { type: 'RESUME'; now: number }
  | { type: 'TICK'; now: number }
  | { type: 'TIMER_DONE'; now: number }
  | { type: 'ANIM_DONE'; now: number; breakMs?: number }
  | { type: 'SKIP'; now: number; breakMs?: number }
  | { type: 'RESET'; now: number }
  | { type: 'DISTRACTED'; now: number }
  | { type: 'REFOCUSED'; now: number }
  | { type: 'RESTORE'; now: number; saved: PersistedSession }

export const DEFAULT_BREAK_MS = 5 * 60_000

export function createInitialState(overrides: Partial<MachineState> = {}): MachineState {
  return {
    phase: 'idle',
    paused: false,
    endsAt: null,
    remainingMs: null,
    sessionIndex: 0,
    longEveryN: 4,
    displayId: 0,
    petPos: { x: 0, y: 0 },
    scale: 100,
    bloomStage: 0,
    distractionLevel: 0,
    ...overrides
  }
}

/** Phases that own a countdown. */
export function isTimedPhase(phase: Phase): boolean {
  return phase === 'focus' || phase === 'break'
}

/** Pause is only legal on Focus and Break (§2.1). */
export function canPause(phase: Phase): boolean {
  return isTimedPhase(phase)
}

/** Phases where the pet is animating between two resting states. */
export function isTransitionPhase(phase: Phase): boolean {
  return phase === 'waking' || phase === 'walkingOut' || phase === 'returning'
}

/** Phases where a click starts the next focus session (§6.2). */
export function isStartablePhase(phase: Phase): boolean {
  return phase === 'idle' || phase === 'ready'
}

/**
 * Bloom stage (§4.5): four growth stages, stage 4 landing exactly on the long
 * break for any `longEveryN`.
 */
export function computeBloomStage(sessionIndex: number, longEveryN: number): 0 | 1 | 2 | 3 | 4 {
  if (sessionIndex <= 0) return 0
  const n = Math.max(1, Math.floor(longEveryN))
  const stage = Math.ceil((sessionIndex / n) * 4)
  return Math.min(4, Math.max(1, stage)) as 0 | 1 | 2 | 3 | 4
}

function remainingOf(state: MachineState, now: number): number | null {
  if (state.paused) return state.remainingMs
  if (state.endsAt == null) return state.remainingMs
  return Math.max(0, state.endsAt - now)
}

/** Ending a focus session: count it, grow the tree, drop the timer. */
function completeFocus(state: MachineState): MachineState {
  const sessionIndex = state.sessionIndex + 1
  return {
    ...state,
    phase: 'waking',
    paused: false,
    endsAt: null,
    remainingMs: null,
    sessionIndex,
    bloomStage: computeBloomStage(sessionIndex, state.longEveryN),
    distractionLevel: 0
  }
}

function beginBreak(state: MachineState, now: number, breakMs?: number): MachineState {
  const duration = breakMs ?? DEFAULT_BREAK_MS
  return {
    ...state,
    phase: 'break',
    paused: false,
    endsAt: now + duration,
    remainingMs: duration
  }
}

/**
 * The single reducer. Every event from every phase is defined here and covered
 * by test/stateMachine.test.ts.
 */
export function next(state: MachineState, event: MachineEvent): MachineState {
  switch (event.type) {
    case 'START': {
      if (!isStartablePhase(state.phase)) return state
      return {
        ...state,
        phase: 'focus',
        paused: false,
        endsAt: event.now + event.focusMs,
        remainingMs: event.focusMs,
        distractionLevel: 0
      }
    }

    case 'PAUSE': {
      if (!canPause(state.phase) || state.paused) return state
      return {
        ...state,
        paused: true,
        remainingMs: remainingOf(state, event.now),
        endsAt: null
      }
    }

    case 'RESUME': {
      if (!canPause(state.phase) || !state.paused) return state
      const remaining = state.remainingMs ?? 0
      if (remaining <= 0) {
        // Nothing left to run: fall straight through the end transition.
        return next({ ...state, paused: false, endsAt: event.now }, { type: 'TIMER_DONE', now: event.now })
      }
      return {
        ...state,
        paused: false,
        endsAt: event.now + remaining,
        remainingMs: remaining
      }
    }

    case 'TICK': {
      if (state.paused || state.endsAt == null) return state
      const remaining = Math.max(0, state.endsAt - event.now)
      if (remaining === state.remainingMs) return state
      return { ...state, remainingMs: remaining }
    }

    case 'TIMER_DONE': {
      if (state.paused) return state
      if (state.phase === 'focus') return completeFocus(state)
      if (state.phase === 'break') {
        return { ...state, phase: 'returning', endsAt: null, remainingMs: null, distractionLevel: 0 }
      }
      return state
    }

    case 'ANIM_DONE': {
      if (state.phase === 'waking') return { ...state, phase: 'walkingOut' }
      if (state.phase === 'walkingOut') return beginBreak(state, event.now, event.breakMs)
      if (state.phase === 'returning') {
        return { ...state, phase: 'ready', endsAt: null, remainingMs: null }
      }
      return state
    }

    case 'SKIP': {
      // Skip performs the current phase's end transition immediately (§2.1).
      // Skipping out of a paused phase also clears the pause: the phase it
      // belonged to is over.
      if (state.phase === 'focus') return completeFocus(state)
      if (state.phase === 'waking') return { ...state, phase: 'walkingOut', paused: false }
      if (state.phase === 'walkingOut') return beginBreak(state, event.now, event.breakMs)
      if (state.phase === 'break') {
        return {
          ...state,
          phase: 'returning',
          paused: false,
          endsAt: null,
          remainingMs: null,
          distractionLevel: 0
        }
      }
      if (state.phase === 'returning') {
        return { ...state, phase: 'ready', paused: false, endsAt: null, remainingMs: null }
      }
      return state
    }

    case 'RESET': {
      return {
        ...state,
        phase: 'idle',
        paused: false,
        endsAt: null,
        remainingMs: null,
        distractionLevel: 0
      }
    }

    case 'DISTRACTED': {
      if (state.phase !== 'focus' || state.paused) return state
      return {
        ...state,
        distractionLevel: Math.min(3, state.distractionLevel + 1) as 0 | 1 | 2 | 3
      }
    }

    case 'REFOCUSED': {
      if (state.distractionLevel === 0) return state
      return { ...state, distractionLevel: 0 }
    }

    case 'RESTORE': {
      return restore(state, event)
    }

    default:
      return state
  }
}

/**
 * Session restore (§6.7).
 *  - Focus/Break still in the future -> resume exactly.
 *  - Ended while away -> count the focus session, land in Ready.
 *    Never auto-start a break after a crash: least surprising.
 *  - Mid-animation phases can't be resumed, so they land in Ready.
 */
function restore(state: MachineState, event: { now: number; saved: PersistedSession }): MachineState {
  const { saved, now } = event
  const sessionIndex = Math.max(0, saved.sessionIndex ?? 0)

  if (saved.phase === 'focus' || saved.phase === 'break') {
    if (saved.pausedAt != null && saved.pausedRemaining != null) {
      return {
        ...state,
        phase: saved.phase,
        paused: true,
        endsAt: null,
        remainingMs: Math.max(0, saved.pausedRemaining),
        sessionIndex,
        bloomStage: computeBloomStage(sessionIndex, state.longEveryN)
      }
    }
    if (saved.endsAt != null && saved.endsAt > now) {
      return {
        ...state,
        phase: saved.phase,
        paused: false,
        endsAt: saved.endsAt,
        remainingMs: saved.endsAt - now,
        sessionIndex,
        bloomStage: computeBloomStage(sessionIndex, state.longEveryN)
      }
    }
    // It expired while we were away.
    const countedSession = saved.phase === 'focus' ? sessionIndex + 1 : sessionIndex
    return {
      ...state,
      phase: 'ready',
      paused: false,
      endsAt: null,
      remainingMs: null,
      sessionIndex: countedSession,
      bloomStage: computeBloomStage(countedSession, state.longEveryN),
      distractionLevel: 0
    }
  }

  if (isTransitionPhase(saved.phase)) {
    return {
      ...state,
      phase: 'ready',
      paused: false,
      endsAt: null,
      remainingMs: null,
      sessionIndex,
      bloomStage: computeBloomStage(sessionIndex, state.longEveryN),
      distractionLevel: 0
    }
  }

  return {
    ...state,
    phase: saved.phase,
    paused: false,
    endsAt: null,
    remainingMs: null,
    sessionIndex,
    bloomStage: computeBloomStage(sessionIndex, state.longEveryN)
  }
}

/** Turns machine state into the broadcast payload (§7.4). */
export function toAppState(state: MachineState): MachineState {
  return state
}
