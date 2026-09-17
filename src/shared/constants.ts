/**
 * Frozen animation clip contract (§4.3). Names, durations and loop flags are a
 * hard contract between the model (bodhi.glb), the main process and the stage
 * renderer. Never rename a clip.
 */
export interface ClipSpec {
  readonly name: string
  readonly duration: number
  readonly loop: boolean
}

export const CLIPS = {
  idleSit: { name: 'idle_sit', duration: 4.0, loop: true },
  meditate: { name: 'meditate', duration: 5.0, loop: true },
  shadesOff: { name: 'shades_off', duration: 0.8, loop: false },
  shadesOn: { name: 'shades_on', duration: 0.6, loop: false },
  standUp: { name: 'stand_up', duration: 1.0, loop: false },
  hopOff: { name: 'hop_off', duration: 0.6, loop: false },
  walk: { name: 'walk', duration: 0.7, loop: true },
  hopOn: { name: 'hop_on', duration: 0.6, loop: false },
  sitDown: { name: 'sit_down', duration: 0.9, loop: false },
  nod: { name: 'nod', duration: 0.6, loop: false },
  shadesCharge: { name: 'shades_charge', duration: 0.3, loop: false },
  glance: { name: 'glance', duration: 0.8, loop: false }
} as const satisfies Record<string, ClipSpec>

export type ClipKey = keyof typeof CLIPS
export const CLIP_NAMES = Object.values(CLIPS).map((c) => c.name)
export const CLIP_COUNT = CLIP_NAMES.length

/** Mixer transition policy (§5.4): never snap. */
export const CROSSFADE = {
  /** minimum crossfade for any clip switch */
  min: 0.15,
  /** default crossfade */
  default: 0.2,
  /** slower, gentler crossfade for the big locomotion changes */
  locomotion: 0.25
} as const

/** Sizes and geometry in DIP px (§5.3): 1 world unit = 1 DIP px. */
export const SIZES = {
  /** rendered Buddha height at 100% scale */
  petHeight: 110,
  scales: [75, 100, 125, 150] as const,
  /** the walk floor sits this far above the bottom of the work area */
  floorInset: 6,
  /** dragging keeps the diorama this far from the work-area edges */
  dragMargin: 30,
  /** default resting spot: bottom-right, 30 px from the edges */
  defaultMargin: 30,
  /** pointermove throttle for hit-testing, Hz (§5.5) */
  hitTestHz: 30,
  /** drag polling for monitor switching, Hz (§5.6) */
  dragPollHz: 30,
  /** how far inside another display before we switch, px (§5.6) */
  displaySwitchInset: 8,
  /** movement (px) above which a press becomes a drag rather than a click */
  dragThresholdPx: 4,
  /** debounce so double-click does not fire start -> pause -> settings (§6.2) */
  clickDebounceMs: 250,
  /** item selected for a "long" break target: aura ring radius / thickness */
  auraRadius: 70,
  auraThickness: 4
} as const

/** Walk mechanics (§4.6, §7.5). */
export const WALK = {
  shortBreakSpeed: 100,
  longBreakSpeed: 70,
  /** ease in/out over the first and last N ms of the path */
  easeMs: 300,
  /** long-break scenic stroll: pause mid-screen and glance around */
  scenicPauseMs: 2000,
  /** dust puff interval during walking, ms */
  dustIntervalMs: 350
} as const

/** Timer (§6.1). */
export const TIMER = {
  /** UI redraw tick; the truth is always endsAt */
  tickMs: 250,
  minTickMs: 250
} as const

/** Distraction watcher (§6.5). */
export const WATCHER = {
  pollMs: 1500,
  defaultGraceSeconds: 5,
  graceRange: [2, 15] as const,
  defaultCooldownSeconds: 30,
  /** tier 2 escalation window */
  tierWindowMs: 5 * 60 * 1000,
  /** switching to an allowed app must kill the beam within this (§6.5) */
  stopMs: 300,
  /** photosensitivity cap (§6.5 safety): never more than 3 flashes/second */
  maxFlashesPerSecond: 3
} as const

/** Render rate caps (§5.7). */
export const RENDER_RATES = {
  idleKeepAliveFps: 1,
  focusFps: 30,
  actionFps: 60
} as const

/** Tree bloom (§4.5). */
export const BLOOM = {
  maxStage: 4,
  popMs: 350,
  /** foliage clusters present at stage 0 */
  baseClusters: 2
} as const

export const BREAK_NUDGES = ['drink water', 'look far away', 'stretch', 'breathe'] as const
