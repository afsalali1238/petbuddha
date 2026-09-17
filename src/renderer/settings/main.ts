import { CUSTOM_RANGES, PRESETS, formatClock } from '@shared/presets'
import type { AppState, DisplayInfo, Settings, Stats } from '@shared/types'

/**
 * The settings window: a plain form over the versioned settings object. It
 * never decides anything — every change goes to main, which re-validates,
 * migrates and broadcasts back (§7.2).
 */
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T

const preset = el<HTMLSelectElement>('preset')
const customGroup = el<HTMLDivElement>('custom')
const focusInput = el<HTMLInputElement>('focus')
const shortInput = el<HTMLInputElement>('short')
const longInput = el<HTMLInputElement>('long')
const everyInput = el<HTMLInputElement>('every')
const customError = el<HTMLParagraphElement>('custom-error')
const displaySelect = el<HTMLSelectElement>('display')
const sizeSelect = el<HTMLSelectElement>('size')
const alwaysOnTop = el<HTMLInputElement>('alwaysOnTop')
const clickThrough = el<HTMLInputElement>('clickThrough')
const walkAcrossScreen = el<HTMLInputElement>('walkAcrossScreen')
const autoStartBreak = el<HTMLInputElement>('autoStartBreak')
const autoStartNextFocus = el<HTMLInputElement>('autoStartNextFocus')
const sound = el<HTMLInputElement>('sound')
const volume = el<HTMLInputElement>('volume')
const footsteps = el<HTMLInputElement>('footsteps')
const hideDuringFullscreen = el<HTMLInputElement>('hideDuringFullscreen')
const launchAtLogin = el<HTMLInputElement>('launchAtLogin')
const shortcut = el<HTMLInputElement>('shortcut')
const lasers = el<HTMLInputElement>('lasers')
const intensity = el<HTMLSelectElement>('intensity')
const grace = el<HTMLInputElement>('grace')
const cooldown = el<HTMLInputElement>('cooldown')
const distractionList = el<HTMLTextAreaElement>('distractionList')
const allowList = el<HTMLTextAreaElement>('allowList')
const reduceMotion = el<HTMLSelectElement>('reduceMotion')
const shadesMode = el<HTMLSelectElement>('shadesMode')
const timeOfDay = el<HTMLSelectElement>('timeOfDay')
const renderingFix = el<HTMLSelectElement>('renderingFix')
const fixNote = el<HTMLParagraphElement>('fix-note')
const statsLine = el<HTMLParagraphElement>('stats')
const clock = el<HTMLDivElement>('clock')
const startPause = el<HTMLButtonElement>('startPause')
const snooze = el<HTMLButtonElement>('snooze')

let settings: Settings | null = null
let state: AppState | null = null
let suppress = false

for (const [value, label] of Object.entries(PRESETS)) {
  const option = document.createElement('option')
  option.value = value
  option.textContent = label.label
  preset.append(option)
}

/* ------------------------------------------------------------------ render */

function renderSettings(next: Settings): void {
  settings = next
  suppress = true
  preset.value = next.preset
  customGroup.classList.toggle('open', next.preset === 'custom')
  focusInput.value = String(next.custom.focus)
  shortInput.value = String(next.custom.shortBreak)
  longInput.value = String(next.custom.longBreak)
  everyInput.value = String(next.custom.longEveryN)
  sizeSelect.value = String(next.scale)
  alwaysOnTop.checked = next.alwaysOnTop
  clickThrough.checked = next.clickThrough
  walkAcrossScreen.checked = next.walkAcrossScreen
  autoStartBreak.checked = next.autoStartBreak
  autoStartNextFocus.checked = next.autoStartNextFocus
  sound.checked = next.sound
  volume.value = String(next.volume)
  footsteps.checked = next.footsteps
  hideDuringFullscreen.checked = next.hideDuringFullscreen
  launchAtLogin.checked = next.launchAtLogin
  shortcut.value = next.globalShortcut
  lasers.checked = next.lasers
  intensity.value = next.laserIntensity
  grace.value = String(next.graceSeconds)
  cooldown.value = String(next.cooldownSeconds)
  distractionList.value = next.distractionList.join('\n')
  allowList.value = next.allowList.join('\n')
  reduceMotion.value = next.reduceMotion
  shadesMode.value = next.shadesMode
  timeOfDay.value = next.timeOfDay
  renderingFix.value = next.renderingFix
  fixNote.textContent =
    next.renderingFix === 'off'
      ? ''
      : 'Applied on the next launch. Use this only if the pet renders as a black rectangle.'
  snooze.disabled = !next.lasers
  suppress = false
}

function renderDisplays(displays: DisplayInfo[]): void {
  const current = displaySelect.value
  displaySelect.innerHTML = ''
  for (const display of displays) {
    const option = document.createElement('option')
    option.value = String(display.id)
    option.textContent = `Display ${display.id} (${display.label})${display.primary ? ' — primary' : ''}`
    displaySelect.append(option)
  }
  if (current) displaySelect.value = current
  if (state) displaySelect.value = String(state.displayId)
}

function renderState(next: AppState): void {
  state = next
  const remaining = next.endsAt ? Math.max(0, next.endsAt - Date.now()) : next.remainingMs
  clock.textContent = formatClock(remaining)
  startPause.textContent =
    next.phase === 'focus' || next.phase === 'break'
      ? next.paused
        ? 'Resume'
        : 'Pause'
      : 'Start'
  if (settings) displaySelect.value = String(next.displayId)
}

function renderStats(next: Stats): void {
  statsLine.textContent = `${next.daily.sessions} sessions · ${next.daily.focusMinutes} focus minutes · ${next.daily.distractions} distractions today`
}

/* ------------------------------------------------------------------ editing */

function patch(patch: Partial<Settings>): void {
  if (suppress || !settings) return
  void window.api.setSettings(patch)
}

function validateCustom(): boolean {
  const ranges: Array<[HTMLInputElement, readonly [number, number], string]> = [
    [focusInput, CUSTOM_RANGES.focus, 'Focus'],
    [shortInput, CUSTOM_RANGES.shortBreak, 'Short break'],
    [longInput, CUSTOM_RANGES.longBreak, 'Long break'],
    [everyInput, CUSTOM_RANGES.longEveryN, 'Long break interval']
  ]
  const errors: string[] = []
  for (const [input, [min, max], label] of ranges) {
    const value = Number(input.value)
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) {
      errors.push(`${label} must be a whole number between ${min} and ${max}`)
    }
  }
  customError.textContent = errors[0] ?? ''
  return errors.length === 0
}

function commitCustom(): void {
  if (!validateCustom()) return
  patch({
    custom: {
      focus: Number(focusInput.value),
      shortBreak: Number(shortInput.value),
      longBreak: Number(longInput.value),
      longEveryN: Number(everyInput.value)
    }
  })
  void window.api.action('save-settings')
}

preset.addEventListener('change', () => patch({ preset: preset.value as Settings['preset'] }))
for (const input of [focusInput, shortInput, longInput, everyInput]) {
  input.addEventListener('change', commitCustom)
  input.addEventListener('input', validateCustom)
}
displaySelect.addEventListener('change', () =>
  void window.api.action('set-display', Number(displaySelect.value))
)
sizeSelect.addEventListener('change', () =>
  patch({ scale: Number(sizeSelect.value) as Settings['scale'] })
)
alwaysOnTop.addEventListener('change', () => patch({ alwaysOnTop: alwaysOnTop.checked }))
clickThrough.addEventListener('change', () => patch({ clickThrough: clickThrough.checked }))
walkAcrossScreen.addEventListener('change', () =>
  patch({ walkAcrossScreen: walkAcrossScreen.checked })
)
autoStartBreak.addEventListener('change', () => patch({ autoStartBreak: autoStartBreak.checked }))
autoStartNextFocus.addEventListener('change', () =>
  patch({ autoStartNextFocus: autoStartNextFocus.checked })
)
sound.addEventListener('change', () => patch({ sound: sound.checked }))
volume.addEventListener('change', () => patch({ volume: Number(volume.value) }))
footsteps.addEventListener('change', () => patch({ footsteps: footsteps.checked }))
hideDuringFullscreen.addEventListener('change', () =>
  patch({ hideDuringFullscreen: hideDuringFullscreen.checked })
)
launchAtLogin.addEventListener('change', () => patch({ launchAtLogin: launchAtLogin.checked }))
shortcut.addEventListener('change', () => patch({ globalShortcut: shortcut.value }))
lasers.addEventListener('change', () => {
  patch({ lasers: lasers.checked, onboardingDone: true })
  void window.api.action('save-settings')
})
intensity.addEventListener('change', () =>
  patch({ laserIntensity: intensity.value as Settings['laserIntensity'] })
)
grace.addEventListener('change', () => patch({ graceSeconds: clampInt(grace.value, 2, 15) }))
cooldown.addEventListener('change', () =>
  patch({ cooldownSeconds: clampInt(cooldown.value, 5, 600) })
)
distractionList.addEventListener('change', () => patch({ distractionList: lines(distractionList.value) }))
allowList.addEventListener('change', () => patch({ allowList: lines(allowList.value) }))
reduceMotion.addEventListener('change', () =>
  patch({ reduceMotion: reduceMotion.value as Settings['reduceMotion'] })
)
shadesMode.addEventListener('change', () =>
  patch({ shadesMode: shadesMode.value as Settings['shadesMode'] })
)
timeOfDay.addEventListener('change', () =>
  patch({ timeOfDay: timeOfDay.value as Settings['timeOfDay'] })
)
renderingFix.addEventListener('change', () =>
  patch({ renderingFix: renderingFix.value as Settings['renderingFix'] })
)

startPause.addEventListener('click', () => {
  if (!state) return
  void window.api.action(
    state.phase === 'focus' || state.phase === 'break'
      ? state.paused
        ? 'resume'
        : 'pause'
      : 'start'
  )
})
el<HTMLButtonElement>('skip').addEventListener('click', () => void window.api.action('skip'))
el<HTMLButtonElement>('reset').addEventListener('click', () => void window.api.action('reset'))
el<HTMLButtonElement>('walk').addEventListener('click', () => void window.api.action('take-walk'))
snooze.addEventListener('click', () => void window.api.action('snooze-lasers'))

function lines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

function clampInt(value: string, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return min
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

/* -------------------------------------------------------------------- boot */

window.api.onSettingsChanged(renderSettings)
window.api.onStatsChanged(renderStats)
window.api.onState(renderState)
window.api.onTimerTick(({ remainingMs }) => {
  if (!state) return
  renderState({ ...state, remainingMs })
})

async function boot(): Promise<void> {
  const [initialSettings, initialStats, displays, initialState] = await Promise.all([
    window.api.getSettings(),
    window.api.getStats(),
    window.api.getDisplays(),
    window.api.getState()
  ])
  renderDisplays(displays)
  renderSettings(initialSettings)
  renderStats(initialStats)
  renderState(initialState)
  window.api.onDisplays(renderDisplays)
}

void boot()
