import { TIMER } from '@shared/constants'

/**
 * The clock (§6.1).
 *
 * The only source of truth is an absolute `endsAt` epoch. We tick purely to
 * redraw, and we reconcile once when the machine wakes from sleep / lock so a
 * phase that ended while the machine was away still fires exactly one
 * TIMER_DONE.
 *
 * Everything the timer needs is injected, so the whole thing is testable
 * without a real clock or a real sleep.
 */

export interface TimerHost {
  now(): number
  /** redraw hint only — must never decide a transition */
  onTick(info: { now: number; remainingMs: number }): void
  /** fires at most once per arming */
  onDone(info: { now: number; overshootMs: number }): void
  /** injectable scheduler; defaults to setInterval */
  schedule?(fn: () => void, ms: number): () => void
}

export class PhaseTimer {
  private endsAtValue: number | null = null
  private cancel: (() => void) | null = null
  private fired = false

  constructor(
    private readonly host: TimerHost,
    private readonly tickMs: number = TIMER.tickMs
  ) {}

  get endsAt(): number | null {
    return this.endsAtValue
  }

  isArmed(): boolean {
    return this.endsAtValue != null
  }

  /** Arm (or re-arm) the countdown for an absolute end time. */
  arm(endsAt: number | null): void {
    this.endsAtValue = endsAt
    this.fired = false
    if (endsAt == null) {
      this.stopTicking()
      // Still emit one tick so the UI can paint its frozen remaining time.
      this.host.onTick({ now: this.host.now(), remainingMs: 0 })
      return
    }
    this.startTicking()
    this.check()
  }

  /** Stop the countdown (pause, reset, or a phase with no timer). */
  disarm(): void {
    this.endsAtValue = null
    this.fired = false
    this.stopTicking()
  }

  /**
   * Called from powerMonitor 'resume' / 'unlock-screen'. If the end time
   * passed while the machine was asleep, fire the done callback exactly once.
   */
  reconcile(): void {
    if (!this.isArmed() || this.fired) return
    this.check()
  }

  /** Force a redraw without changing the countdown. */
  poke(): void {
    if (this.endsAtValue == null) return
    this.host.onTick({
      now: this.host.now(),
      remainingMs: Math.max(0, this.endsAtValue - this.host.now())
    })
  }

  dispose(): void {
    this.disarm()
  }

  private check(): void {
    const endsAt = this.endsAtValue
    if (endsAt == null || this.fired) return
    const now = this.host.now()
    const remaining = endsAt - now
    if (remaining <= 0) {
      this.fired = true
      this.stopTicking()
      this.host.onDone({ now, overshootMs: -remaining })
      return
    }
    this.host.onTick({ now, remainingMs: remaining })
  }

  private startTicking(): void {
    if (this.cancel) return
    const schedule = this.host.schedule ?? defaultSchedule
    this.cancel = schedule(() => this.check(), this.tickMs)
  }

  private stopTicking(): void {
    this.cancel?.()
    this.cancel = null
  }
}

function defaultSchedule(fn: () => void, ms: number): () => void {
  const handle = setInterval(fn, ms)
  return () => clearInterval(handle)
}
