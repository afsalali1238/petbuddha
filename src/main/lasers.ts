import { WATCHER } from '@shared/constants'
import { IPC } from '@shared/ipc'
import type { BlastPayload, PetPosition, Settings } from '@shared/types'
import {
  evaluate,
  initialWatcherState,
  type FocusWatcherState,
  type WindowInfo
} from './focusLogic'
import type { ForegroundInfo } from './focusWatcher'
import type { WindowManager } from './windows'

/**
 * Blast orchestration (§6.5, §6.6): decides *what* to fire, the overlay window
 * only draws it.
 *
 * Escalation: glance -> aimed beam -> sweep -> sweep + shake, with a grace
 * period, a cooldown, a snooze, and a hard 3-flashes-per-second cap.
 */
export interface LaserDeps {
  windows: WindowManager
  getSettings: () => Settings
  /** true only during unpaused focus */
  isFocusActive: () => boolean
  /** main's resolved reduce-motion boolean (the setting may be 'auto', §6.3) */
  isReduceMotion: () => boolean
  /** lens positions in stage-window DIP, reported by the renderer */
  getLensPositions: () => { left: PetPosition; right: PetPosition } | null
  getWorkArea: () => { x: number; y: number; width: number; height: number }
  onGlance: (direction: 'left' | 'right') => void
  onNod: () => void
  onDistraction: () => void
}

const TIER_DURATION: Record<number, number> = { 1: 1500, 2: 3000, 3: 3000 }

export class LaserController {
  private watcherState: FocusWatcherState = initialWatcherState()
  private blastTimer: NodeJS.Timeout | null = null
  private chargeTimer: NodeJS.Timeout | null = null

  constructor(private readonly deps: LaserDeps) {}

  /** One foreground sample from the 1.5 s poll. */
  handleSample(info: ForegroundInfo | null): void {
    const settings = this.deps.getSettings()
    if (!settings.lasers) {
      this.stopNow()
      return
    }

    const window: WindowInfo | null = info
      ? { title: info.title, processName: info.processName, url: info.url }
      : null

    const outcome = evaluate(
      this.watcherState,
      {
        window,
        now: Date.now(),
        active: this.deps.isFocusActive() && !this.deps.windows.isSuppressed,
        snoozeUntil: settings.laserSnoozeUntil,
        graceSeconds: settings.graceSeconds,
        cooldownSeconds: settings.cooldownSeconds,
        target: info ? this.clampTarget(info) : null
      },
      settings.allowList,
      settings.distractionList
    )

    this.watcherState = outcome.state

    if (outcome.countsAsDistraction) this.deps.onDistraction()

    switch (outcome.action) {
      case 'glance': {
        // Tier 0: the comedy beat. He looks; nothing is fired (§6.5).
        const direction = this.directionOf(outcome.target)
        this.deps.onGlance(direction)
        break
      }
      case 'blast': {
        const target = outcome.target
        if (!target) break
        this.fire(outcome.tier, target)
        break
      }
      case 'stop': {
        this.stopNow()
        this.deps.onNod()
        break
      }
      default:
        break
    }
  }

  private directionOf(target: PetPosition | null): 'left' | 'right' {
    if (!target) return 'right'
    const workArea = this.deps.getWorkArea()
    const lens = this.deps.getLensPositions()
    const originX = lens ? (lens.left.x + lens.right.x) / 2 : workArea.x + workArea.width / 2
    return target.x < originX ? 'left' : 'right'
  }

  /** Keep the beam inside the selected display (§6.6). */
  private clampTarget(info: ForegroundInfo): PetPosition {
    const workArea = this.deps.getWorkArea()
    const cx = info.bounds.x + info.bounds.width / 2
    const cy = info.bounds.y + info.bounds.height / 2
    return {
      x: Math.min(workArea.x + workArea.width - 2, Math.max(workArea.x + 2, cx)),
      y: Math.min(workArea.y + workArea.height - 2, Math.max(workArea.y + 2, cy))
    }
  }

  private fire(tier: 0 | 1 | 2 | 3, target: PetPosition): void {
    if (tier === 0) return
    const settings = this.deps.getSettings()
    const lens = this.deps.getLensPositions()
    if (!lens) return

    // The lenses glow for 0.3 s before the beam leaves (§4.3 shades_charge).
    this.deps.windows.sendToStage('stage:play-clip', {
      clip: 'shades_charge',
      crossfade: 0.15
    })

    if (this.chargeTimer) clearTimeout(this.chargeTimer)
    this.chargeTimer = setTimeout(() => {
      const reduceMotion = settings.reduceMotion === 'on'
      const payload: BlastPayload = {
        lensL: lens.left,
        lensR: lens.right,
        target,
        tier,
        reduceMotion,
        intensity: settings.laserIntensity
      }
      this.deps.windows.fireBlast(reduceMotion ? { ...payload, reduceMotion: true } : payload)
      if (tier >= 3 && !reduceMotion) {
        // Tier 3: sweep plus a camera shake and a small pill (§6.5).
        this.deps.windows.sendToStage(IPC.stageShake, { px: 3, ms: 320 })
        this.deps.windows.sendToStage(IPC.stagePill, {
          text: 'Return to the path',
          x: target.x,
          y: target.y
        })
      }
    }, 300)

    const duration = TIER_DURATION[tier] ?? 1500
    if (this.blastTimer) clearTimeout(this.blastTimer)
    this.blastTimer = setTimeout(() => this.deps.windows.blastStop(), duration + 300)
  }

  /** Switching to an allowed app must kill the beam well inside 300 ms. */
  stopNow(): void {
    if (this.blastTimer) {
      clearTimeout(this.blastTimer)
      this.blastTimer = null
    }
    if (this.chargeTimer) {
      clearTimeout(this.chargeTimer)
      this.chargeTimer = null
    }
    this.deps.windows.blastStop()
  }

  reset(): void {
    this.stopNow()
    this.watcherState = initialWatcherState()
  }

  snooze(minutes = 15): number {
    this.stopNow()
    return Date.now() + minutes * 60_000
  }

  get cooldownMs(): number {
    return WATCHER.defaultCooldownSeconds * 1000
  }
}
