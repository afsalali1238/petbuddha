import type { PresetId } from './types'

export interface Preset {
  id: PresetId
  label: string
  focus: number
  shortBreak: number
  longBreak: number
  longEveryN: number
}

/** §6.1 timing presets. All values are minutes. */
export const PRESETS: Record<PresetId, Preset> = {
  classic: { id: 'classic', label: 'Classic', focus: 25, shortBreak: 5, longBreak: 15, longEveryN: 4 },
  short: { id: 'short', label: 'Short', focus: 15, shortBreak: 3, longBreak: 10, longEveryN: 4 },
  deep: { id: 'deep', label: 'Deep', focus: 50, shortBreak: 10, longBreak: 20, longEveryN: 4 },
  monk: { id: 'monk', label: 'Monk mode', focus: 90, shortBreak: 20, longBreak: 30, longEveryN: 2 },
  custom: { id: 'custom', label: 'Custom', focus: 25, shortBreak: 5, longBreak: 15, longEveryN: 4 }
}

export const CUSTOM_RANGES = {
  focus: [1, 240],
  shortBreak: [1, 120],
  longBreak: [1, 180],
  longEveryN: [1, 12]
} as const

export const MINUTES_TO_MS = 60_000

export function presetById(id: PresetId): Preset {
  return PRESETS[id] ?? PRESETS.classic
}

/**
 * Resolves the effective durations: custom overrides win when the preset is
 * `custom`, otherwise the named preset is authoritative.
 */
export function resolveDuration(
  preset: PresetId,
  custom: { focus: number; shortBreak: number; longBreak: number; longEveryN: number }
): { focus: number; shortBreak: number; longBreak: number; longEveryN: number } {
  if (preset === 'custom') {
    return {
      focus: clampInt(custom.focus, CUSTOM_RANGES.focus),
      shortBreak: clampInt(custom.shortBreak, CUSTOM_RANGES.shortBreak),
      longBreak: clampInt(custom.longBreak, CUSTOM_RANGES.longBreak),
      longEveryN: clampInt(custom.longEveryN, CUSTOM_RANGES.longEveryN)
    }
  }
  const p = presetById(preset)
  return { focus: p.focus, shortBreak: p.shortBreak, longBreak: p.longBreak, longEveryN: p.longEveryN }
}

/** Long break lands every Nth completed focus session (§2, §4.5). */
export function isLongBreak(sessionIndex: number, longEveryN: number): boolean {
  const n = Math.max(1, Math.floor(longEveryN))
  return sessionIndex > 0 && sessionIndex % n === 0
}

function clampInt(value: number, [min, max]: readonly [number, number]): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

export function formatClock(ms: number | null): string {
  if (ms == null) return '--:--'
  const total = Math.max(0, Math.ceil(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
