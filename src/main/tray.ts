import { Menu, Tray, nativeImage, app } from 'electron'
import { join } from 'node:path'
import { PRESETS, formatClock, presetById } from '@shared/presets'
import type { DisplayInfo, PresetId, Settings } from '@shared/types'
import type { Phase } from './stateMachine'

export interface TrayState {
  phase: Phase
  paused: boolean
  remainingMs: number | null
  settings: Settings
  displays: DisplayInfo[]
  displayId: number
}

export interface TrayActions {
  start(): void
  pause(): void
  resume(): void
  skip(): void
  reset(): void
  openSettings(): void
  takeWalk(): void
  setPreset(id: PresetId): void
  selectDisplay(id: number): void
  snoozeLasers(minutes: number): void
  quit(): void
}

/**
 * Tray icon, live countdown tooltip, and the context menu — which is also what
 * a right-click on the pet opens (§6.2, §6.4).
 */
export class TrayController {
  private tray: Tray | null = null
  private state: TrayState | null = null

  constructor(private readonly actions: TrayActions) {}

  create(): void {
    if (this.tray) return
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'assets', 'icons', 'tray-32.png')
      : join(app.getAppPath(), 'assets', 'icons', 'tray-32.png')
    let image = nativeImage.createFromPath(iconPath)
    if (image.isEmpty()) {
      // Never let a missing asset take the app down: fall back to a 1px icon.
      image = nativeImage.createEmpty()
    }
    this.tray = new Tray(image)
    this.tray.setToolTip('Bodhi Pomodoro')
    this.tray.on('click', () => this.actions.start())
    this.tray.on('double-click', () => this.actions.openSettings())
    this.tray.on('right-click', () => this.showMenu())
    if (this.state) this.update(this.state)
  }

  update(state: TrayState): void {
    this.state = state
    if (!this.tray) return
    this.tray.setToolTip(this.tooltipFor(state))
    this.tray.setContextMenu(this.buildMenu(state))
  }

  showMenu(): void {
    if (!this.tray) return
    this.tray.popUpContextMenu(this.state ? this.buildMenu(this.state) : undefined)
  }

  /** Windows tray icons have no text, so the countdown lives in the tooltip. */
  private tooltipFor(state: TrayState): string {
    const { phase, paused, remainingMs } = state
    if (phase === 'idle') return 'Bodhi Pomodoro — ready'
    if (phase === 'ready') return 'Bodhi Pomodoro — back, click to sit'
    if (phase === 'waking') return 'Bodhi Pomodoro — awakening'
    if (phase === 'walkingOut') return 'Bodhi Pomodoro — walking out'
    if (phase === 'returning') return 'Bodhi Pomodoro — returning'
    const label = phase === 'focus' ? 'Meditating' : 'Out walking'
    const clock = formatClock(remainingMs)
    return `Bodhi Pomodoro — ${paused ? 'Paused' : label} ${clock}`
  }

  private buildMenu(state: TrayState): Menu {
    const { phase, paused } = state
    const inFocus = phase === 'focus'
    const inBreak = phase === 'break'
    const canSkip = inFocus || inBreak || phase === 'walkingOut' || phase === 'returning'

    const startPauseResume = !inFocus && !inBreak
      ? { label: 'Start', click: () => this.actions.start() }
      : paused
        ? { label: 'Resume', click: () => this.actions.resume() }
        : { label: 'Pause', click: () => this.actions.pause() }

    const presetMenu = Menu.buildFromTemplate(
      (Object.keys(PRESETS) as PresetId[]).map((id) => ({
        label: presetById(id).label,
        type: 'radio' as const,
        checked: state.settings.preset === id,
        click: () => this.actions.setPreset(id)
      }))
    )

    const displayMenu = Menu.buildFromTemplate(
      state.displays.map((display) => ({
        label: `Display ${display.id} (${display.label})${display.primary ? ' — primary' : ''}`,
        type: 'radio' as const,
        checked: display.id === state.displayId,
        click: () => this.actions.selectDisplay(display.id)
      }))
    )

    return Menu.buildFromTemplate([
      startPauseResume,
      { label: 'Skip', enabled: canSkip, click: () => this.actions.skip() },
      { label: 'Reset', click: () => this.actions.reset() },
      { type: 'separator' },
      { label: 'Presets', submenu: presetMenu },
      { label: 'Display', submenu: displayMenu },
      { type: 'separator' },
      {
        label: 'Snooze lasers 15 min',
        enabled: state.settings.lasers,
        click: () => this.actions.snoozeLasers(15)
      },
      { label: 'Settings…', click: () => this.actions.openSettings() },
      { label: 'Take Bodhi for a walk', click: () => this.actions.takeWalk() },
      { type: 'separator' },
      { label: 'Quit', click: () => this.actions.quit() }
    ])
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }
}
