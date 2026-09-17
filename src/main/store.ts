import Store from 'electron-store'
import type { PersistedSession, PetPosition, Settings, Stats } from '@shared/types'
import {
  defaultSettings,
  defaultStats,
  migrateSession,
  migrateSettings,
  migrateStats,
  recordDistraction,
  recordFocusSession,
  sessionToPersist,
  setBloomStage,
  SETTINGS_VERSION,
  STATS_VERSION,
  todayKey
} from './storeLogic'

/**
 * Persistence (§7.6): two versioned JSON files in userData — settings.json and
 * stats.json — plus the live session record, which is written on every state
 * change so a crash mid-focus can be resumed (§6.7).
 *
 * All coercion and migration lives in ./storeLogic.ts, which is pure and unit
 * tested; this file is only the electron-store shell.
 */
export class AppStore {
  private readonly settings: Store<Settings & { session?: PersistedSession }>
  private readonly stats: Store<Stats>

  constructor() {
    this.settings = new Store<Settings & { session?: PersistedSession }>({
      name: 'settings',
      cwd: undefined,
      defaults: { ...defaultSettings(), schemaVersion: SETTINGS_VERSION } as Settings & {
        session?: PersistedSession
      }
    })
    this.stats = new Store<Stats>({
      name: 'stats',
      defaults: { ...defaultStats(), schemaVersion: STATS_VERSION }
    })
  }

  getSettings(): Settings {
    return migrateSettings(this.settings.store)
  }

  patchSettings(patch: Partial<Settings>): Settings {
    const merged = migrateSettings({ ...this.getSettings(), ...patch })
    this.settings.store = merged
    return merged
  }

  getStats(): Stats {
    return migrateStats(this.stats.store, todayKey())
  }

  setStats(next: Stats): Stats {
    const migrated = migrateStats(next, todayKey())
    this.stats.store = migrated
    return migrated
  }

  recordSession(focusMinutes: number): Stats {
    return this.setStats(recordFocusSession(this.getStats(), focusMinutes, todayKey()))
  }

  countDistraction(): Stats {
    return this.setStats(recordDistraction(this.getStats(), todayKey()))
  }

  setBloomStage(stage: 0 | 1 | 2 | 3 | 4): Stats {
    return this.setStats(setBloomStage(this.getStats(), stage, todayKey()))
  }

  // --- per-display pet positions (§5.6) -------------------------------------

  getPetPosition(displayId: number, fallback: PetPosition): PetPosition {
    const settings = this.getSettings()
    const saved = settings.petPositions[String(displayId)]
    return saved ? { ...saved } : { ...fallback }
  }

  setPetPosition(displayId: number, position: PetPosition): Settings {
    const settings = this.getSettings()
    return this.patchSettings({
      petPositions: { ...settings.petPositions, [String(displayId)]: position }
    })
  }

  // --- session restore (§6.7) -----------------------------------------------

  saveSession(session: PersistedSession): void {
    this.settings.set('session', sessionToPersist(session))
  }

  loadSession(): PersistedSession | null {
    return migrateSession(this.settings.get('session'))
  }

  clearSession(): void {
    this.settings.delete('session')
  }

  /** Where electron-store put the files, for the Settings window. */
  get paths(): { settings: string; stats: string } {
    return { settings: this.settings.path, stats: this.stats.path }
  }
}
