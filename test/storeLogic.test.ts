import { describe, expect, it } from 'vitest'
import {
  breakMsFor,
  defaultSettings,
  durationsFor,
  focusMsFor,
  migrateSession,
  migrateSettings,
  migrateStats,
  recordDistraction,
  recordFocusSession,
  setBloomStage,
  timeOfDayFor
} from '@main/storeLogic'
import type { Settings } from '@shared/types'

describe('settings migration', () => {
  it('fills in defaults from nothing', () => {
    const settings = migrateSettings(null)
    expect(settings.preset).toBe('classic')
    expect(settings.scale).toBe(100)
    expect(settings.graceSeconds).toBe(5)
    expect(settings.cooldownSeconds).toBe(30)
    expect(settings.distractionList).toContain('youtube.com')
    expect(settings.allowList.length).toBeGreaterThan(0)
    expect(settings.schemaVersion).toBe(1)
  })

  it('clamps junk values instead of trusting them', () => {
    const settings = migrateSettings({
      scale: 9999,
      volume: 400,
      graceSeconds: 900,
      preset: 'not-a-preset',
      custom: { focus: 9999, shortBreak: -5, longBreak: 12, longEveryN: 99 }
    })
    expect(settings.scale).toBe(100)
    expect(settings.volume).toBe(100)
    expect(settings.graceSeconds).toBe(15)
    expect(settings.preset).toBe('classic')
    expect(settings.custom.focus).toBe(240)
    expect(settings.custom.shortBreak).toBe(1)
    expect(settings.custom.longEveryN).toBe(12)
  })

  it('keeps valid user choices', () => {
    const settings = migrateSettings({ preset: 'monk', scale: 150, volume: 42, lasers: true })
    expect(settings.preset).toBe('monk')
    expect(settings.scale).toBe(150)
    expect(settings.volume).toBe(42)
    expect(settings.lasers).toBe(true)
  })

  it('sanitises saved per-display positions', () => {
    const settings = migrateSettings({
      petPositions: { '1': { x: 10, y: 20 }, '2': { x: 'nope', y: 5 }, '3': null }
    })
    expect(settings.petPositions['1']).toEqual({ x: 10, y: 20 })
    expect(settings.petPositions['2']).toBeUndefined()
    expect(settings.petPositions['3']).toBeUndefined()
  })

  it('drops empty allow lists back to the defaults', () => {
    expect(migrateSettings({ allowList: [] }).allowList.length).toBeGreaterThan(0)
    expect(migrateSettings({ allowList: ['   '] }).allowList.length).toBeGreaterThan(0)
    expect(migrateSettings({ allowList: ['Slack'] }).allowList).toEqual(['Slack'])
  })
})

describe('durations', () => {
  it('resolves named presets', () => {
    const settings = defaultSettings()
    expect(focusMsFor(settings)).toBe(25 * 60_000)
    expect(breakMsFor(settings, false)).toBe(5 * 60_000)
    expect(breakMsFor(settings, true)).toBe(15 * 60_000)
  })

  it('honours custom durations', () => {
    const settings: Settings = {
      ...defaultSettings(),
      preset: 'custom',
      custom: { focus: 1, shortBreak: 2, longBreak: 3, longEveryN: 4 }
    }
    expect(focusMsFor(settings)).toBe(60_000)
    expect(breakMsFor(settings, false)).toBe(120_000)
    expect(breakMsFor(settings, true)).toBe(180_000)
    expect(durationsFor(settings).longEveryN).toBe(4)
  })

  it('clamps out-of-range custom durations', () => {
    const settings: Settings = {
      ...defaultSettings(),
      preset: 'custom',
      custom: { focus: 0, shortBreak: 9999, longBreak: 3, longEveryN: 4 }
    }
    expect(durationsFor(settings).focus).toBe(1)
    expect(durationsFor(settings).shortBreak).toBe(120)
  })
})

describe('stats', () => {
  it('starts the day empty', () => {
    const stats = migrateStats(null, '2026-09-17')
    expect(stats.daily).toEqual({
      date: '2026-09-17',
      sessions: 0,
      focusMinutes: 0,
      distractions: 0
    })
    expect(stats.totalSessions).toBe(0)
    expect(stats.bloomStage).toBe(0)
  })

  it('rolls over at the user\'s midnight and keeps nothing but totals', () => {
    let stats = migrateStats(null, '2026-09-16')
    stats = recordFocusSession(stats, 25, '2026-09-16')
    stats = recordFocusSession(stats, 25, '2026-09-16')
    expect(stats.daily.sessions).toBe(2)
    expect(stats.totalSessions).toBe(2)

    const nextDay = migrateStats(stats, '2026-09-17')
    expect(nextDay.daily).toEqual({
      date: '2026-09-17',
      sessions: 0,
      focusMinutes: 0,
      distractions: 0
    })
    // No history beyond today (§7.6), but the lifetime total survives.
    expect(nextDay.totalSessions).toBe(2)
    expect(nextDay.bloomStage).toBe(0)
  })

  it('records focus minutes and distractions', () => {
    let stats = migrateStats(null, '2026-09-17')
    stats = recordFocusSession(stats, 50, '2026-09-17')
    stats = recordDistraction(stats, '2026-09-17')
    stats = recordDistraction(stats, '2026-09-17')
    expect(stats.daily.sessions).toBe(1)
    expect(stats.daily.focusMinutes).toBe(50)
    expect(stats.daily.distractions).toBe(2)
  })

  it('persists the bloom stage across sessions', () => {
    let stats = migrateStats(null, '2026-09-17')
    stats = setBloomStage(stats, 3, '2026-09-17')
    expect(migrateStats(stats, '2026-09-17').bloomStage).toBe(3)
    expect(setBloomStage(stats, 9 as 0 | 1 | 2 | 3 | 4, '2026-09-17').bloomStage).toBe(4)
  })
})

describe('session record', () => {
  it('round-trips a live session', () => {
    const session = migrateSession({
      phase: 'focus',
      endsAt: 123,
      pausedAt: null,
      pausedRemaining: null,
      sessionIndex: 2
    })
    expect(session).toEqual({
      phase: 'focus',
      endsAt: 123,
      pausedAt: null,
      pausedRemaining: null,
      sessionIndex: 2
    })
  })

  it('rejects nonsense', () => {
    expect(migrateSession(null)).toBeNull()
    expect(migrateSession({ phase: 'sleeping' })).toBeNull()
    expect(migrateSession('nope')).toBeNull()
  })
})

describe('time of day', () => {
  const at = (hour: number): Date => {
    const date = new Date(2026, 8, 17, hour, 0, 0)
    return date
  }

  it('follows the local clock', () => {
    expect(timeOfDayFor(at(3), 'auto')).toBe('night')
    expect(timeOfDayFor(at(6), 'auto')).toBe('dawn')
    expect(timeOfDayFor(at(12), 'auto')).toBe('day')
    expect(timeOfDayFor(at(18), 'auto')).toBe('dusk')
    expect(timeOfDayFor(at(22), 'auto')).toBe('night')
  })

  it('can be pinned for development', () => {
    expect(timeOfDayFor(at(12), 'night')).toBe('night')
    expect(timeOfDayFor(at(3), 'day')).toBe('day')
  })
})
