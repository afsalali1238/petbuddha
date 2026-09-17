import { CUSTOM_RANGES, MINUTES_TO_MS, resolveDuration } from '@shared/presets'
import type {
  DailyStats,
  PersistedSession,
  PetPosition,
  ReduceMotionSetting,
  ScaleSetting,
  Settings,
  Stats,
  TimeOfDaySetting,
  LaserIntensity,
  RenderingFix,
  ShadesMode,
  PresetId
} from '@shared/types'
import type { TimeOfDay } from '@shared/palette'

export const SETTINGS_VERSION = 1
export const STATS_VERSION = 1

/** §6.5 default distraction list. */
export const DEFAULT_DISTRACTIONS = [
  'youtube.com',
  'instagram.com',
  'facebook.com',
  'x.com',
  'tiktok.com',
  'reddit.com',
  'netflix.com',
  'WhatsApp',
  'Telegram',
  'Steam'
]

/** §6.5 default allow list (the user's work apps). Editable; always wins. */
export const DEFAULT_ALLOW = [
  'code.exe',
  'devenv.exe',
  'winword.exe',
  'excel.exe',
  'powerpnt.exe',
  'outlook.exe',
  'obsidian.exe',
  'notion.exe',
  'figma.exe',
  'WindowsTerminal.exe'
]

export const SCALE_VALUES: ScaleSetting[] = [75, 100, 125, 150]

export function defaultSettings(): Settings {
  return {
    schemaVersion: SETTINGS_VERSION,
    preset: 'classic',
    custom: { focus: 25, shortBreak: 5, longBreak: 15, longEveryN: 4 },
    displayId: null,
    scale: 100,
    alwaysOnTop: true,
    clickThrough: false,
    walkAcrossScreen: true,
    autoStartBreak: true,
    autoStartNextFocus: false,
    sound: true,
    volume: 60,
    hideDuringFullscreen: true,
    launchAtLogin: false,
    globalShortcut: 'Ctrl+Alt+P',
    lasers: false,
    laserIntensity: 'beam',
    graceSeconds: 5,
    cooldownSeconds: 30,
    distractionList: [...DEFAULT_DISTRACTIONS],
    allowList: [...DEFAULT_ALLOW],
    reduceMotion: 'auto',
    footsteps: false,
    shadesMode: 'hero',
    timeOfDay: 'auto',
    renderingFix: 'off',
    petPositions: {},
    onboardingDone: false,
    laserSnoozeUntil: null
  }
}

export function defaultStats(date = todayKey()): Stats {
  return {
    schemaVersion: STATS_VERSION,
    daily: { date, sessions: 0, focusMinutes: 0, distractions: 0 },
    bloomStage: 0,
    totalSessions: 0
  }
}

/** Local-time day key, so "today" rolls over at the user's midnight. */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * Migrations are forward-only. Each entry upgrades settings from version N to
 * N+1; unknown fields are dropped by the merge that follows.
 */
const SETTINGS_MIGRATIONS: Array<(raw: Record<string, unknown>) => Record<string, unknown>> = []

const STATS_MIGRATIONS: Array<(raw: Record<string, unknown>) => Record<string, unknown>> = []

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  return clamp(Math.round(Number(value)), min, max, fallback)
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function strArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return [...fallback]
  const cleaned = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
  return cleaned.length > 0 ? cleaned : [...fallback]
}

function oneOf<T extends string | number>(value: unknown, allowed: readonly T[], fallback: T): T {
  // Numeric enums (the scale setting) and string enums both live in here, so
  // the type check has to cover both.
  if (typeof value !== 'string' && typeof value !== 'number') return fallback
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** Coerce anything found on disk into a valid, complete Settings object. */
export function migrateSettings(raw: unknown): Settings {
  const base = defaultSettings()
  if (!raw || typeof raw !== 'object') return base
  let data = { ...(raw as Record<string, unknown>) }

  const fromVersion = int(data.schemaVersion, 0, 999, 0)
  for (let v = fromVersion; v < SETTINGS_VERSION; v++) {
    const migration = SETTINGS_MIGRATIONS[v]
    if (migration) data = migration(data)
  }

  const customRaw = (data.custom ?? {}) as Record<string, unknown>
  const preset = oneOf<PresetId>(data.preset, ['classic', 'short', 'deep', 'monk', 'custom'], base.preset)

  const positions: Record<string, PetPosition> = {}
  if (data.petPositions && typeof data.petPositions === 'object') {
    for (const [key, value] of Object.entries(data.petPositions as Record<string, unknown>)) {
      const pos = value as { x?: unknown; y?: unknown }
      if (pos && Number.isFinite(Number(pos.x)) && Number.isFinite(Number(pos.y))) {
        positions[key] = { x: Number(pos.x), y: Number(pos.y) }
      }
    }
  }

  return {
    schemaVersion: SETTINGS_VERSION,
    preset,
    custom: {
      focus: int(customRaw.focus, CUSTOM_RANGES.focus[0], CUSTOM_RANGES.focus[1], base.custom.focus),
      shortBreak: int(
        customRaw.shortBreak,
        CUSTOM_RANGES.shortBreak[0],
        CUSTOM_RANGES.shortBreak[1],
        base.custom.shortBreak
      ),
      longBreak: int(
        customRaw.longBreak,
        CUSTOM_RANGES.longBreak[0],
        CUSTOM_RANGES.longBreak[1],
        base.custom.longBreak
      ),
      longEveryN: int(
        customRaw.longEveryN,
        CUSTOM_RANGES.longEveryN[0],
        CUSTOM_RANGES.longEveryN[1],
        base.custom.longEveryN
      )
    },
    displayId: data.displayId == null ? null : int(data.displayId, 0, 9999, 0),
    scale: oneOf<ScaleSetting>(data.scale, SCALE_VALUES, base.scale),
    alwaysOnTop: bool(data.alwaysOnTop, base.alwaysOnTop),
    clickThrough: bool(data.clickThrough, base.clickThrough),
    walkAcrossScreen: bool(data.walkAcrossScreen, base.walkAcrossScreen),
    autoStartBreak: bool(data.autoStartBreak, base.autoStartBreak),
    autoStartNextFocus: bool(data.autoStartNextFocus, base.autoStartNextFocus),
    sound: bool(data.sound, base.sound),
    volume: Math.round(clamp(Number(data.volume), 0, 100, base.volume)),
    hideDuringFullscreen: bool(data.hideDuringFullscreen, base.hideDuringFullscreen),
    launchAtLogin: bool(data.launchAtLogin, base.launchAtLogin),
    globalShortcut: str(data.globalShortcut, base.globalShortcut),
    lasers: bool(data.lasers, base.lasers),
    laserIntensity: oneOf<LaserIntensity>(data.laserIntensity, ['beam', 'sweep', 'full'], base.laserIntensity),
    graceSeconds: int(data.graceSeconds, 2, 15, base.graceSeconds),
    cooldownSeconds: int(data.cooldownSeconds, 5, 600, base.cooldownSeconds),
    distractionList: strArray(data.distractionList, base.distractionList),
    allowList: strArray(data.allowList, base.allowList),
    reduceMotion: oneOf<ReduceMotionSetting>(data.reduceMotion, ['auto', 'on', 'off'], base.reduceMotion),
    footsteps: bool(data.footsteps, base.footsteps),
    shadesMode: oneOf<ShadesMode>(data.shadesMode, ['hero', 'frost'], base.shadesMode),
    timeOfDay: oneOf<TimeOfDaySetting>(data.timeOfDay, ['auto', 'dawn', 'day', 'dusk', 'night'], base.timeOfDay),
    renderingFix: oneOf<RenderingFix>(
      data.renderingFix,
      ['off', 'angle-d3d11', 'disable-gpu-compositing', 'disable-hw-accel'],
      base.renderingFix
    ),
    petPositions: positions,
    onboardingDone: bool(data.onboardingDone, base.onboardingDone),
    laserSnoozeUntil:
      data.laserSnoozeUntil == null ? null : Math.max(0, Math.round(Number(data.laserSnoozeUntil)))
  }
}

export function migrateStats(raw: unknown, date = todayKey()): Stats {
  const base = defaultStats(date)
  if (!raw || typeof raw !== 'object') return base
  let data = { ...(raw as Record<string, unknown>) }

  const fromVersion = int(data.schemaVersion, 0, 999, 0)
  for (let v = fromVersion; v < STATS_VERSION; v++) {
    const migration = STATS_MIGRATIONS[v]
    if (migration) data = migration(data)
  }

  const dailyRaw = (data.daily ?? {}) as Partial<DailyStats>
  const daily: DailyStats = {
    date: str(dailyRaw.date, date),
    sessions: Math.max(0, int(dailyRaw.sessions, 0, 9999, 0)),
    focusMinutes: Math.max(0, int(dailyRaw.focusMinutes, 0, 1440, 0)),
    distractions: Math.max(0, int(dailyRaw.distractions, 0, 9999, 0))
  }
  // Rollover: a stored day that isn't today carries nothing forward (§7.6:
  // no history beyond today).
  if (daily.date !== date) {
    daily.date = date
    daily.sessions = 0
    daily.focusMinutes = 0
    daily.distractions = 0
  }

  return {
    schemaVersion: STATS_VERSION,
    daily,
    bloomStage: int(data.bloomStage, 0, 4, 0) as Stats['bloomStage'],
    totalSessions: Math.max(0, int(data.totalSessions, 0, 1_000_000, 0))
  }
}

/** Merge a partial patch into validated settings. Unknown keys are ignored. */
export function mergeSettings(current: Settings, patch: Partial<Settings>): Settings {
  return migrateSettings({ ...current, ...patch })
}

export function recordFocusSession(stats: Stats, focusMinutes: number, date = todayKey()): Stats {
  const rolled = migrateStats({ ...stats, daily: stats.daily }, date)
  return {
    ...rolled,
    daily: {
      ...rolled.daily,
      sessions: rolled.daily.sessions + 1,
      focusMinutes: rolled.daily.focusMinutes + Math.max(0, Math.round(focusMinutes))
    },
    totalSessions: rolled.totalSessions + 1
  }
}

export function recordDistraction(stats: Stats, date = todayKey()): Stats {
  const rolled = migrateStats({ ...stats, daily: stats.daily }, date)
  return {
    ...rolled,
    daily: { ...rolled.daily, distractions: rolled.daily.distractions + 1 }
  }
}

export function setBloomStage(stats: Stats, stage: 0 | 1 | 2 | 3 | 4, date = todayKey()): Stats {
  const rolled = migrateStats({ ...stats, daily: stats.daily }, date)
  return { ...rolled, bloomStage: Math.min(4, Math.max(0, Math.round(stage))) as Stats['bloomStage'] }
}

export function sessionToPersist(input: PersistedSession): PersistedSession {
  return {
    phase: input.phase,
    endsAt: input.endsAt ?? null,
    pausedAt: input.pausedAt ?? null,
    pausedRemaining: input.pausedRemaining ?? null,
    sessionIndex: Math.max(0, Math.round(input.sessionIndex ?? 0))
  }
}

export function migrateSession(raw: unknown): PersistedSession | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const phase = data.phase
  const valid = ['idle', 'focus', 'waking', 'walkingOut', 'break', 'returning', 'ready']
  if (typeof phase !== 'string' || !valid.includes(phase)) return null
  return sessionToPersist({
    phase: phase as PersistedSession['phase'],
    endsAt: data.endsAt == null ? null : Number(data.endsAt),
    pausedAt: data.pausedAt == null ? null : Number(data.pausedAt),
    pausedRemaining: data.pausedRemaining == null ? null : Number(data.pausedRemaining),
    sessionIndex: Number(data.sessionIndex ?? 0)
  })
}

/**
 * Time-of-day light rig from the local clock (§4.5). Settings can pin a rig for
 * development.
 */
export function timeOfDayFor(date = new Date(), override: TimeOfDaySetting = 'auto'): TimeOfDay {
  if (override !== 'auto') return override
  const hour = date.getHours()
  if (hour < 5 || hour >= 20) return 'night'
  if (hour < 8) return 'dawn'
  if (hour < 17) return 'day'
  return 'dusk'
}

export function durationsFor(settings: Settings): {
  focus: number
  shortBreak: number
  longBreak: number
  longEveryN: number
} {
  return resolveDuration(settings.preset, settings.custom)
}

export function focusMsFor(settings: Settings): number {
  return durationsFor(settings).focus * MINUTES_TO_MS
}

export function breakMsFor(settings: Settings, useLongBreak: boolean): number {
  const { shortBreak, longBreak } = durationsFor(settings)
  return (useLongBreak ? longBreak : shortBreak) * MINUTES_TO_MS
}
