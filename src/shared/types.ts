/** Phase names (§2.1). Pause is a flag, never a phase. */
export type Phase = 'idle' | 'focus' | 'waking' | 'walkingOut' | 'break' | 'returning' | 'ready'

export type PhaseEvent =
  | 'START'
  | 'PAUSE'
  | 'RESUME'
  | 'TICK'
  | 'TIMER_DONE'
  | 'ANIM_DONE'
  | 'SKIP'
  | 'RESET'
  | 'DISTRACTED'
  | 'REFOCUSED'
  | 'RESTORE'

export type ScaleSetting = 75 | 100 | 125 | 150
export type LaserIntensity = 'beam' | 'sweep' | 'full'
export type ReduceMotionSetting = 'auto' | 'on' | 'off'
export type TimeOfDaySetting = 'auto' | 'dawn' | 'day' | 'dusk' | 'night'
export type ShadesMode = 'hero' | 'frost'
export type RenderingFix = 'off' | 'angle-d3d11' | 'disable-gpu-compositing' | 'disable-hw-accel'
export type PresetId = 'classic' | 'short' | 'deep' | 'monk' | 'custom'

/** Shape broadcast to every renderer (§7.4). */
export interface AppState {
  phase: Phase
  paused: boolean
  /** epoch ms when the current phase ends; null when paused or timeless */
  endsAt: number | null
  /** derived from endsAt, never the source of truth (§6.1) */
  remainingMs: number | null
  sessionIndex: number
  longEveryN: number
  displayId: number
  petPos: { x: number; y: number }
  scale: number
  bloomStage: 0 | 1 | 2 | 3 | 4
  distractionLevel: 0 | 1 | 2 | 3
}

export interface PetPosition {
  x: number
  y: number
}

/** Everything in §6.3, versioned for forward-only migration. */
export interface Settings {
  schemaVersion: number
  preset: PresetId
  custom: { focus: number; shortBreak: number; longBreak: number; longEveryN: number }
  displayId: number | null
  scale: ScaleSetting
  alwaysOnTop: boolean
  clickThrough: boolean
  walkAcrossScreen: boolean
  autoStartBreak: boolean
  autoStartNextFocus: boolean
  sound: boolean
  volume: number
  hideDuringFullscreen: boolean
  launchAtLogin: boolean
  globalShortcut: string
  lasers: boolean
  laserIntensity: LaserIntensity
  graceSeconds: number
  cooldownSeconds: number
  distractionList: string[]
  allowList: string[]
  reduceMotion: ReduceMotionSetting
  footsteps: boolean
  /** §4.7 art route escape hatch: lens frost instead of the hero shades clips */
  shadesMode: ShadesMode
  /** dev override for the time-of-day light rig */
  timeOfDay: TimeOfDaySetting
  /** §8 driver fallback ladder, applied on relaunch */
  renderingFix: RenderingFix
  /** per-display saved diorama positions, keyed by display id */
  petPositions: Record<string, PetPosition>
  /** onboarding asked the laser opt-in question once */
  onboardingDone: boolean
  /** snooze lasers until this epoch ms */
  laserSnoozeUntil: number | null
}

export interface DailyStats {
  date: string
  sessions: number
  focusMinutes: number
  distractions: number
}

export interface Stats {
  schemaVersion: number
  daily: DailyStats
  bloomStage: 0 | 1 | 2 | 3 | 4
  totalSessions: number
}

/** §6.7 session restore payload — persisted on every change. */
export interface PersistedSession {
  phase: Phase
  endsAt: number | null
  pausedAt: number | null
  pausedRemaining: number | null
  sessionIndex: number
}

export interface DisplayInfo {
  id: number
  label: string
  primary: boolean
  /** work area in DIP, already excluding the taskbar (§8) */
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
}

/** main -> stage: which clip to play and how to crossfade (§5.4). */
export interface PlayClipPayload {
  clip: string
  crossfade: number
  /** loop overrides the clip default (used to hold the last frame of a pose) */
  loop?: boolean
  /** clamp at the end instead of looping, for one-shot poses */
  clampWhenFinished?: boolean
}

/** main -> stage: a walk in display DIP coordinates (§7.5). */
export interface WalkPathPayload {
  from: PetPosition
  to: PetPosition
  speed: number
  /** long-break scenic stroll: pause mid-path and glance around (§4.6) */
  scenic: boolean
  /** stay inside the diorama (reduce motion / fallback, §4.6) */
  treeSceneStroll: boolean
}

/** main -> laser overlay (§6.6). */
export interface BlastPayload {
  lensL: PetPosition
  lensR: PetPosition
  target: PetPosition
  tier: 1 | 2 | 3
  reduceMotion: boolean
  intensity: LaserIntensity
}

export interface TrayUpdate {
  label: string
  tooltip: string
  phase: Phase
  paused: boolean
  canSkip: boolean
}

export type SoundName = 'bell' | 'soft-bell' | 'pew'
