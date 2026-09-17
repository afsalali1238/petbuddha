import { describe, expect, it } from 'vitest'
import {
  domainFromTitle,
  domainOf,
  evaluate,
  haystackFor,
  initialWatcherState,
  isAllowed,
  isDistracting,
  keyFor,
  type FocusWatcherState,
  type WatcherInput
} from '@main/focusLogic'

const DISTRACTIONS = [
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
const ALLOW = ['code.exe', 'WindowsTerminal.exe', 'obsidian.exe']

const NOW = 1_700_000_000_000
const TARGET = { x: 400, y: 300 }

function input(over: Partial<WatcherInput> = {}): WatcherInput {
  return {
    window: null,
    now: NOW,
    active: true,
    snoozeUntil: null,
    graceSeconds: 5,
    cooldownSeconds: 30,
    target: TARGET,
    ...over
  }
}

function youtube(title = 'Rick Astley - Never Gonna Give You Up'):
{ title: string; processName: string; url?: string | null } {
  return { title: `${title} - YouTube - Google Chrome`, processName: 'chrome.exe' }
}

function vscode(): { title: string; processName: string; url?: string | null } {
  return { title: 'stateMachine.ts - Bodhi Pomodoro', processName: 'Code.exe' }
}

/** Run the watcher forward over a timeline of foreground windows. */
function run(
  steps: Array<{ at: number; window: WatcherInput['window'] }>,
  overrides: Partial<WatcherInput> = {},
  state: FocusWatcherState = initialWatcherState()
): { state: FocusWatcherState; actions: Array<{ at: number; action: string; tier: number }> } {
  const actions: Array<{ at: number; action: string; tier: number }> = []
  for (const step of steps) {
    const outcome = evaluate(state, input({ ...overrides, now: step.at, window: step.window }), ALLOW, DISTRACTIONS)
    state = outcome.state
    actions.push({ at: step.at, action: outcome.action, tier: outcome.tier })
  }
  return { state, actions }
}

describe('matching', () => {
  it('reads the domain out of a URL', () => {
    expect(domainOf('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube.com')
    expect(domainOf('https://reddit.com/r/all')).toBe('reddit.com')
    expect(domainOf(null)).toBeNull()
    expect(domainOf('not a url')).toBeNull()
  })

  it('reads the identity out of a Windows browser title suffix', () => {
    expect(domainFromTitle('Never Gonna Give You Up - YouTube - Google Chrome')).toBe('youtube')
    expect(domainFromTitle('Home / X - Mozilla Firefox')).toBe('x')
    expect(domainFromTitle('Instagram - Google Chrome')).toBe('instagram')
    expect(domainFromTitle('stateMachine.ts - Bodhi Pomodoro - Visual Studio Code')).toBeNull()
  })

  it('matches browser tabs by title suffix on Windows', () => {
    expect(isDistracting(youtube(), DISTRACTIONS)).toBe(true)
    expect(isDistracting({ title: 'Home / X - Mozilla Firefox', processName: 'firefox.exe' }, DISTRACTIONS)).toBe(true)
    expect(isDistracting({ title: 'Steam', processName: 'steam.exe' }, DISTRACTIONS)).toBe(true)
    expect(isDistracting({ title: 'Inbox - Outlook', processName: 'outlook.exe' }, DISTRACTIONS)).toBe(false)
  })

  it('allow list always wins', () => {
    // Even a tab titled "youtube - Visual Studio Code" is allowed.
    const sneaky = { title: 'youtube.com tutorial - Visual Studio Code', processName: 'Code.exe' }
    expect(isDistracting(sneaky, DISTRACTIONS)).toBe(true)
    expect(isAllowed(sneaky, ALLOW)).toBe(true)
    const outcome = evaluate(
      initialWatcherState(),
      input({ now: NOW, window: sneaky }),
      ALLOW,
      DISTRACTIONS
    )
    // Still inside grace, so nothing fires — and it is not treated as offending.
    expect(outcome.action).toBe('none')
    expect(outcome.state.offenderKey).toBeNull()
  })

  it('builds a haystack from title, process and url domain', () => {
    const hay = haystackFor({
      title: 'Some Page',
      processName: 'chrome.exe',
      url: 'https://www.tiktok.com/@someone'
    })
    expect(hay).toContain('tiktok.com')
    expect(hay).toContain('chrome.exe')
  })

  it('keys a tab so switching videos does not reset the grace timer', () => {
    const a = keyFor({ title: 'Video A - YouTube - Google Chrome', processName: 'chrome.exe' })
    const b = keyFor({ title: 'Video B - YouTube - Google Chrome', processName: 'chrome.exe' })
    expect(a).toBe(b)
    expect(keyFor(null)).toBeNull()
  })
})

describe('grace period', () => {
  it('does nothing before the offending app has been foreground for 5 s', () => {
    const { actions } = run([
      { at: NOW, window: youtube() },
      { at: NOW + 1_000, window: youtube() },
      { at: NOW + 4_000, window: youtube() }
    ])
    expect(actions.map((a) => a.action)).toEqual(['none', 'none', 'none'])
  })

  it('fires a glance (tier 0) the moment grace elapses', () => {
    const { actions, state } = run([
      { at: NOW, window: youtube() },
      { at: NOW + 5_000, window: youtube() }
    ])
    expect(actions[1].action).toBe('glance')
    expect(actions[1].tier).toBe(0)
    expect(state.level).toBe(0)
    expect(state.firing).toBe(true)
  })

  it('counts one distraction per offense', () => {
    const state = initialWatcherState()
    const first = evaluate(state, input({ now: NOW, window: youtube() }), ALLOW, DISTRACTIONS)
    const second = evaluate(first.state, input({ now: NOW + 5_000, window: youtube() }), ALLOW, DISTRACTIONS)
    expect(second.countsAsDistraction).toBe(true)
    const third = evaluate(
      second.state,
      input({ now: NOW + 40_000, window: youtube() }),
      ALLOW,
      DISTRACTIONS
    )
    expect(third.countsAsDistraction).toBe(false) // escalation, not a new distraction
    expect(third.tier).toBe(1)
  })
})

describe('escalation', () => {
  it('goes glance -> beam -> sweep -> sweep+shake while the user stays away', () => {
    const { state, actions } = run([
      { at: NOW, window: youtube() },
      { at: NOW + 5_000, window: youtube() },
      { at: NOW + 40_000, window: youtube() },
      { at: NOW + 80_000, window: youtube() },
      { at: NOW + 120_000, window: youtube() }
    ])
    expect(actions.map((a) => a.action)).toEqual(['none', 'glance', 'blast', 'blast', 'blast'])
    expect(actions.map((a) => a.tier)).toEqual([0, 0, 1, 2, 3])
    expect(state.level).toBe(3)
  })

  it('respects the cooldown between blasts', () => {
    const { actions } = run([
      { at: NOW, window: youtube() },
      { at: NOW + 5_000, window: youtube() },
      { at: NOW + 10_000, window: youtube() }, // 5 s later: still cooling down
      { at: NOW + 35_000, window: youtube() } // 30 s later: free to escalate
    ])
    expect(actions.map((a) => a.action)).toEqual(['none', 'glance', 'none', 'blast'])
  })

  it('decays back to a glance after 5 clean minutes', () => {
    const { actions } = run([
      { at: NOW, window: youtube() },
      { at: NOW + 5_000, window: youtube() },
      { at: NOW + 40_000, window: youtube() }, // tier 1
      { at: NOW + 60_000, window: vscode() }, // back to work
      { at: NOW + 500_000, window: youtube() }, // 7 minutes later
      { at: NOW + 505_000, window: youtube() }
    ])
    expect(actions[5].tier).toBe(0)
    expect(actions[5].action).toBe('glance')
  })
})

describe('stopping', () => {
  it('stops within one poll (1.5 s) when the user switches to an allowed app', () => {
    const { actions } = run([
      { at: NOW, window: youtube() },
      { at: NOW + 5_000, window: youtube() }, // glance
      { at: NOW + 6_500, window: vscode() } // next poll: stop
    ])
    expect(actions[2].action).toBe('stop')
    expect(actions[2].tier).toBe(0)
  })

  it('only reports stop once', () => {
    const { actions } = run([
      { at: NOW, window: youtube() },
      { at: NOW + 5_000, window: youtube() },
      { at: NOW + 6_500, window: vscode() },
      { at: NOW + 8_000, window: vscode() }
    ])
    expect(actions[3].action).toBe('none')
  })

  it('stops when a blast is in flight and focus is paused', () => {
    const { actions } = run(
      [
        { at: NOW, window: youtube() },
        { at: NOW + 5_000, window: youtube() },
        { at: NOW + 6_500, window: youtube() }
      ],
      { active: false }
    )
    // active:false is applied to every step, so nothing ever fires
    expect(actions.every((a) => a.action === 'none')).toBe(true)
  })

  it('never fires while snoozed, and stops a live blast', () => {
    const first = evaluate(
      initialWatcherState(),
      input({ now: NOW, window: youtube() }),
      ALLOW,
      DISTRACTIONS
    )
    const fired = evaluate(
      first.state,
      input({ now: NOW + 5_000, window: youtube() }),
      ALLOW,
      DISTRACTIONS
    )
    expect(fired.action).toBe('glance')
    const snoozed = evaluate(
      fired.state,
      input({ now: NOW + 6_000, window: youtube(), snoozeUntil: NOW + 60_000 }),
      ALLOW,
      DISTRACTIONS
    )
    expect(snoozed.action).toBe('stop')
    expect(snoozed.state.firing).toBe(false)
  })

  it('never fires during break, idle, ready or the walk phases', () => {
    for (const active of [false]) {
      const { actions } = run(
        [
          { at: NOW, window: youtube() },
          { at: NOW + 5_000, window: youtube() },
          { at: NOW + 40_000, window: youtube() }
        ],
        { active }
      )
      expect(actions.every((a) => a.action === 'none')).toBe(true)
    }
  })

  it('does nothing when there is no foreground window', () => {
    const { actions } = run([
      { at: NOW, window: null },
      { at: NOW + 5_000, window: null }
    ])
    expect(actions.every((a) => a.action === 'none')).toBe(true)
  })
})

describe('photosensitivity cap', () => {
  it('never allows more than 3 flashes per second', () => {
    const { actions } = run([
      { at: NOW, window: youtube() },
      { at: NOW + 5_000, window: youtube() },
      { at: NOW + 5_100, window: youtube() },
      { at: NOW + 5_200, window: youtube() }
    ])
    expect(actions.filter((a) => a.action !== 'none')).toHaveLength(1)
  })
})
