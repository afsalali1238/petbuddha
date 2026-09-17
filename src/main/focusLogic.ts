import { WATCHER } from '@shared/constants'

/**
 * Distraction detection and escalation (§6.5) — pure, no I/O, no Electron.
 *
 * Policy recap:
 *  - The watcher only runs during *unpaused Focus*.
 *  - The allow list always wins.
 *  - Nothing fires until the offending app has been foreground for the grace
 *    period (5 s by default).
 *  - Escalation: glance -> aimed beam -> sweep -> sweep + shake. Levels decay
 *    back to a glance if the user has been clean for 5 minutes.
 *  - Cooldown between blasts; a hard photosensitivity cap of 3 flashes/second.
 *  - Switching to an allowed app stops everything within 300 ms.
 */

export interface WindowInfo {
  title: string
  processName: string
  url?: string | null
}

export interface FocusWatcherState {
  /** identity of the current foreground app/tab */
  currentKey: string | null
  /** when it became foreground */
  since: number | null
  /** escalation level: 0 glance, 1 beam, 2 sweep, 3 sweep + shake */
  level: 0 | 1 | 2 | 3
  lastBlastAt: number | null
  lastOffenseAt: number | null
  /** a beam is currently on screen */
  firing: boolean
  /** the offender we were last annoyed about */
  offenderKey: string | null
}

export type WatcherAction = 'none' | 'glance' | 'blast' | 'stop'

export interface WatcherInput {
  window: WindowInfo | null
  now: number
  /** true only during unpaused focus */
  active: boolean
  snoozeUntil: number | null
  graceSeconds: number
  cooldownSeconds: number
  /** centre of the offending window, in the selected display's DIP */
  target: { x: number; y: number } | null
}

export interface WatcherOutcome {
  state: FocusWatcherState
  action: WatcherAction
  tier: 0 | 1 | 2 | 3
  target: { x: number; y: number } | null
  /** true when a brand new distraction has begun (count it once for stats) */
  countsAsDistraction: boolean
}

export const MIN_BLAST_GAP_MS = Math.ceil(1000 / WATCHER.maxFlashesPerSecond)

export function initialWatcherState(): FocusWatcherState {
  return {
    currentKey: null,
    since: null,
    level: 0,
    lastBlastAt: null,
    lastOffenseAt: null,
    firing: false,
    offenderKey: null
  }
}

/** Pull the registrable domain out of a URL, or null. */
export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return host || null
  } catch {
    return null
  }
}

/**
 * Windows browsers put the page identity in the title suffix, e.g.
 *   "Never Gonna Give You Up - YouTube - Google Chrome"
 *   "Home / X - Mozilla Firefox"
 * We take the last non-browser token as the "domain-ish" identity.
 */
const BROWSER_TOKENS = [
  'google chrome',
  'chrome',
  'microsoft edge',
  'edge',
  'mozilla firefox',
  'firefox',
  'opera',
  'brave',
  'vivaldi'
]

export function domainFromTitle(title: string | null | undefined): string | null {
  if (!title) return null
  const parts = title
    .split(' - ')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return null
  const tail = parts[parts.length - 1].toLowerCase()
  if (!BROWSER_TOKENS.some((b) => tail === b || tail.endsWith(` ${b}`) || tail.includes(b))) return null
  const candidate = parts[parts.length - 2]
  if (!candidate) return null
  // "Home / X" -> the trailing token after a slash is the real identity
  const afterSlash = candidate.split('/').map((p) => p.trim()).filter(Boolean).pop()
  const value = (afterSlash ?? candidate).trim()
  if (value.length === 0 || value.length > 60) return null
  return value.toLowerCase()
}

/** Everything we match a rule against, lowercased. */
export function haystackFor(window: WindowInfo | null): string {
  if (!window) return ''
  const bits = [window.title, window.processName]
  const urlDomain = domainOf(window.url)
  if (urlDomain) bits.push(urlDomain)
  const titleDomain = domainFromTitle(window.title)
  if (titleDomain) bits.push(titleDomain)
  return bits.filter(Boolean).join(' ').toLowerCase()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Rules are matched loosely — a rule is a substring of the haystack — but with
 * one important extension: a domain rule such as `youtube.com` must also match
 * the identity we scrape out of a Windows browser title, which is bare
 * `youtube` (no TLD). To stay safe, the stripped label only matches as a whole
 * token, never as a loose substring (so `x.com` cannot match "Excel").
 */
export function matchesRule(haystack: string, rule: string): boolean {
  const needle = rule.trim().toLowerCase()
  if (!needle) return false
  if (haystack.includes(needle)) return true

  const looksLikeDomain = needle.includes('.') && !needle.includes(' ')
  if (!looksLikeDomain) return false

  const label = needle.split('.')[0]
  if (!label) return false
  const token = new RegExp(`(^|[\\s/.,;:|()\\[\\]-])${escapeRegExp(label)}($|[\\s/.,;:|()\\[\\]-])`)
  return token.test(haystack)
}

export function isAllowed(window: WindowInfo | null, allowList: string[]): boolean {
  const haystack = haystackFor(window)
  return allowList.some((rule) => matchesRule(haystack, rule))
}

export function isDistracting(window: WindowInfo | null, distractionList: string[]): boolean {
  const haystack = haystackFor(window)
  return distractionList.some((rule) => matchesRule(haystack, rule))
}

/** Identity used to decide "is this still the same tab/app?". */
export function keyFor(window: WindowInfo | null): string | null {
  if (!window) return null
  const domain = domainOf(window.url) ?? domainFromTitle(window.title)
  const proc = window.processName.toLowerCase()
  if (domain) return `${proc}::${domain}`
  return `${proc}::${window.title.trim().toLowerCase()}`
}

function nextLevel(state: FocusWatcherState, now: number): 0 | 1 | 2 | 3 {
  const stale = state.lastOffenseAt == null || now - state.lastOffenseAt > WATCHER.tierWindowMs
  if (stale) return 0
  return Math.min(3, (state.level + 1) as number) as 0 | 1 | 2 | 3
}

/**
 * One poll of the watcher. Returns the next state plus whatever the app should
 * do right now.
 */
export function evaluate(
  state: FocusWatcherState,
  input: WatcherInput,
  allowList: string[],
  distractionList: string[]
): WatcherOutcome {
  const key = keyFor(input.window)
  let next: FocusWatcherState = { ...state }
  let action: WatcherAction = 'none'
  let tier: 0 | 1 | 2 | 3 = state.level
  let countsAsDistraction = false

  const suppressed = !input.active || (input.snoozeUntil != null && input.now < input.snoozeUntil)

  if (suppressed) {
    if (next.firing) {
      action = 'stop'
      next = { ...next, firing: false }
    }
    // Keep the offender clock running so we don't reward tabbing away to hide.
    next = { ...next, currentKey: key, since: key === state.currentKey ? state.since : input.now }
    return { state: next, action, tier, target: null, countsAsDistraction: false }
  }

  const switched = key !== state.currentKey
  if (switched) {
    next = { ...next, currentKey: key, since: input.now }
  }

  const offending = input.window != null && !isAllowed(input.window, allowList) && isDistracting(input.window, distractionList)

  if (!offending) {
    if (next.firing || state.offenderKey != null) {
      action = 'stop'
    }
    next = { ...next, firing: false, offenderKey: null }
    return { state: next, action, tier: 0, target: null, countsAsDistraction: false }
  }

  // Still inside the grace period? Do nothing yet.
  const since = next.since ?? input.now
  const foregroundFor = input.now - since
  if (foregroundFor < input.graceSeconds * 1000) {
    return { state: next, action: 'none', tier: state.level, target: null, countsAsDistraction: false }
  }

  // Cooldown / photosensitivity cap.
  const sinceBlast = next.lastBlastAt == null ? Number.POSITIVE_INFINITY : input.now - next.lastBlastAt
  const cooldownMs = Math.max(input.cooldownSeconds * 1000, MIN_BLAST_GAP_MS)
  if (sinceBlast < cooldownMs) {
    return { state: next, action: 'none', tier: state.level, target: null, countsAsDistraction: false }
  }

  const level = nextLevel(next, input.now)
  next = {
    ...next,
    level,
    lastBlastAt: input.now,
    lastOffenseAt: input.now,
    firing: true,
    offenderKey: key
  }
  tier = level
  action = level === 0 ? 'glance' : 'blast'
  countsAsDistraction = level === 0

  return { state: next, action, tier, target: input.target, countsAsDistraction }
}

/** Called when focus ends or the watcher is disabled. */
export function resetWatcher(): FocusWatcherState {
  return initialWatcherState()
}
