import { app, globalShortcut, ipcMain, powerMonitor, screen } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { electronApp } from '@electron-toolkit/utils'
import { BREAK_NUDGES, CLIPS, SIZES } from '@shared/constants'
import { IPC } from '@shared/ipc'
import { MINUTES_TO_MS, isLongBreak } from '@shared/presets'
import type { PetPosition, Settings, SoundName } from '@shared/types'
import { allDisplays, listDisplays, resolveDisplay, type DisplayEntry } from './displays'
import { coversWorkArea, type ForegroundInfo } from './focusWatcher'
import { LaserController } from './lasers'
import { FocusWatcher } from './focusWatcher'
import { AppStore } from './store'
import { breakMsFor, durationsFor, focusMsFor } from './storeLogic'
import { createInitialState, next, type MachineEvent, type MachineState } from './stateMachine'
import { PhaseTimer } from './timer'
import { TrayController } from './tray'
import { applyRenderingFix, WindowManager } from './windows'
import { querySystemAnimations, resolveReduceMotion } from './systemSettings'
import {
  clampToWorkArea,
  defaultPetPosition,
  displayContaining,
  petHeightForScale,
  planWalkBack,
  planWalkOut
} from './walkPath'

/**
 * The main process is the single source of truth (§7.2). Every phase change is
 * one `dispatch()` call: the state machine decides the new state, this file
 * performs the side effects (clips, sounds, walks, timers, stats), and the
 * renderers are told what to draw. Renderers never run timers and never decide
 * transitions.
 */
const ISLAND_HALF_WIDTH = 0.91

class BodhiApp {
  private readonly store = new AppStore()
  private readonly windows = new WindowManager()
  private settings: Settings
  private state: MachineState
  private display: DisplayEntry
  private timer: PhaseTimer
  private watcher: FocusWatcher
  private lasers: LaserController
  private tray: TrayController
  private lensPositions: { left: PetPosition; right: PetPosition } | null = null
  private scheduled: NodeJS.Timeout[] = []
  private dragPoller: NodeJS.Timeout | null = null
  private dragOffset: PetPosition = { x: 0, y: 0 }
  private clickDebounce: NodeJS.Timeout | null = null
  private nudgeTimer: NodeJS.Timeout | null = null
  private nudgeIndex = 0
  private demoPreset: Settings['preset'] | null = null
  /** Windows' "show animations" switch, queried once when needed (§6.3 auto) */
  private systemAnimationsEnabled = true

  constructor() {
    this.settings = this.store.getSettings()
    this.display = resolveDisplay(this.settings.displayId)
    this.state = createInitialState({
      petPos: this.store.getPetPosition(this.display.id, defaultPetPosition(this.display.workArea)),
      scale: this.settings.scale,
      longEveryN: durationsFor(this.settings).longEveryN,
      displayId: this.display.id,
      bloomStage: this.store.getStats().bloomStage
    })

    this.timer = new PhaseTimer({
      now: () => Date.now(),
      onTick: ({ remainingMs }) => {
        this.state = next(this.state, { type: 'TICK', now: Date.now() })
        this.broadcastTick(remainingMs)
      },
      onDone: () => this.dispatch({ type: 'TIMER_DONE', now: Date.now() })
    })

    this.watcher = new FocusWatcher((info) => this.onForegroundSample(info))
    this.lasers = new LaserController({
      windows: this.windows,
      getSettings: () => this.settings,
      isFocusActive: () => this.state.phase === 'focus' && !this.state.paused,
      isReduceMotion: () => this.reduceMotion(),
      getLensPositions: () => this.lensPositions,
      getWorkArea: () => this.display.workArea,
      onGlance: (direction) => this.playClip(direction === 'left' ? 'glance' : 'glance_right'),
      onNod: () => this.playClip('nod'),
      onDistraction: () => {
        this.store.countDistraction()
        this.pushStats()
      }
    })

    this.tray = new TrayController({
      start: () => this.dispatch({ type: 'START', now: Date.now(), focusMs: this.focusMs() }),
      pause: () => this.dispatch({ type: 'PAUSE', now: Date.now() }),
      resume: () => this.dispatch({ type: 'RESUME', now: Date.now() }),
      skip: () => this.dispatch({ type: 'SKIP', now: Date.now(), breakMs: this.breakMs() }),
      reset: () => this.dispatch({ type: 'RESET', now: Date.now() }),
      openSettings: () => this.windows.showSettings(),
      takeWalk: () => this.takeForWalk(),
      setPreset: (id) => this.applySettings({ preset: id }),
      selectDisplay: (id) => this.selectDisplay(id),
      snoozeLasers: (minutes) => {
        this.applySettings({ laserSnoozeUntil: this.lasers.snooze(minutes) })
        this.pushState()
      },
      quit: () => app.quit()
    })
  }

  /** Runs when the app is re-activated (dock/taskbar click). */
  show(): void {
    this.windows.showStage()
  }

  // ---------------------------------------------------------------- lifecycle

  async boot(): Promise<void> {
    applyRenderingFix(this.settings.renderingFix)

    // Single instance: a second launch focuses the running one and quits (§6.7).
    const gotLock = app.requestSingleInstanceLock()
    if (!gotLock) {
      app.quit()
      return
    }
    app.on('second-instance', () => {
      this.windows.showStage()
      this.windows.showSettings()
    })

    electronApp.setAppUserModelId('com.bodhi.pomodoro')

    await app.whenReady()

    this.windows.createStage(this.display)
    this.windows.fitStage(this.display, {
      petPos: this.state.petPos,
      scale: this.state.scale
    })
    this.windows.ensureLaser(this.display)
    this.tray.create()
    this.registerIpc()
    this.registerGlobalShortcut()
    this.registerPowerMonitor()
    this.registerDisplayEvents()
    this.applyLoginItem()
    this.restoreSession()

    this.pushState()
    this.pushStats()
    this.pushSettings()
    this.pushReduceMotion()
    void this.refreshSystemSettings()
    this.watcher.start()
    this.maybeOnboard()
    this.startNudgeRotation()
    void this.setupUpdater()
  }

  // ------------------------------------------------------------- transitions

  private dispatch(event: MachineEvent): void {
    const previous = this.state
    const updated = next(previous, event)
    const changed =
      updated.phase !== previous.phase ||
      updated.paused !== previous.paused ||
      updated.sessionIndex !== previous.sessionIndex ||
      updated.bloomStage !== previous.bloomStage ||
      updated.distractionLevel !== previous.distractionLevel
    this.state = updated
    this.persistSession()

    if (updated.phase !== previous.phase) {
      this.clearScheduled()
      this.exitPhase(previous.phase)
      this.enterPhase(updated.phase, previous.phase)
    }

    if (changed) {
      this.pushState()
      this.updateTray()
    }
    if (updated.bloomStage !== previous.bloomStage) {
      this.store.setBloomStage(updated.bloomStage)
      this.windows.sendToStage(IPC.stageBloom, { stage: updated.bloomStage })
    }
  }

  /** Everything that must stop when a phase ends. */
  private exitPhase(phase: MachineState['phase']): void {
    if (phase === 'focus') {
      this.timer.disarm()
      this.lasers.reset()
    }
    if (phase === 'break') {
      this.timer.disarm()
    }
  }

  /** Everything that must happen when a phase begins (§2.1). */
  private enterPhase(phase: MachineState['phase'], previous: MachineState['phase']): void {
    switch (phase) {
      case 'idle': {
        this.playClip('idle_sit')
        this.windows.sendToStage(IPC.stageAtSeat, { on: true })
        break
      }

      case 'focus': {
        const focusMs = this.focusMs()
        this.timer.arm(Date.now() + focusMs)
        if (previous === 'ready' || previous === 'idle') {
          // The hero beat: he takes his shades off and settles in (§3.4).
          if (this.settings.shadesMode === 'hero') {
            this.playClip('shades_off')
            this.after(CLIPS.shadesOff.duration * 1000, () => this.playClip('meditate'))
          } else {
            this.windows.sendToStage(IPC.stageLensFrost, { on: true })
            this.playClip('meditate')
          }
        } else {
          this.playClip('meditate')
        }
        break
      }

      case 'waking': {
        this.playSound('bell')
        this.windows.sendToStage(IPC.stageLensFrost, { on: false })
        if (this.settings.shadesMode === 'hero') this.playClip('shades_on')
        // Anticipation, stand up, hop off the cushion, then go (§2.1).
        this.after(CLIPS.shadesOn.duration * 1000, () => {
          this.playClip('stand_up')
          this.after(CLIPS.standUp.duration * 1000, () => {
            this.playClip('hop_off')
            this.after(CLIPS.hopOff.duration * 1000, () => {
              this.dispatch({ type: 'ANIM_DONE', now: Date.now(), breakMs: this.breakMs() })
            })
          })
        })
        this.recordCompletedSession()
        break
      }

      case 'walkingOut': {
        const plan = planWalkOut({
          petPos: this.state.petPos,
          workArea: this.display.workArea,
          petWidth: petHeightForScale(this.state.scale) * 0.8,
          islandHalfWidth: ISLAND_HALF_WIDTH * petHeightForScale(this.state.scale),
          longBreak: this.currentBreakIsLong(),
          treeSceneStroll: !this.settings.walkAcrossScreen || this.reduceMotion()
        })
        this.windows.sendToStage(IPC.stageAtSeat, { on: false })
        this.windows.sendToStage(IPC.stageWalkPath, plan)
        if (this.settings.footsteps) this.playSound('pew')
        this.after(plan.durationMs, () =>
          this.dispatch({ type: 'ANIM_DONE', now: Date.now(), breakMs: this.breakMs() })
        )
        break
      }

      case 'break': {
        this.timer.arm(Date.now() + this.breakMs())
        this.windows.sendToStage(IPC.stageBreakUi, { on: true, long: this.currentBreakIsLong() })
        break
      }

      case 'returning': {
        this.playSound('soft-bell')
        this.windows.sendToStage(IPC.stageBreakUi, { on: false })
        const plan = planWalkBack({
          petPos: this.state.petPos,
          workArea: this.display.workArea,
          petWidth: petHeightForScale(this.state.scale) * 0.8,
          islandHalfWidth: ISLAND_HALF_WIDTH * petHeightForScale(this.state.scale),
          longBreak: this.currentBreakIsLong(),
          treeSceneStroll: !this.settings.walkAcrossScreen || this.reduceMotion()
        })
        this.windows.sendToStage(IPC.stageWalkPath, plan)
        this.after(plan.durationMs, () => {
          this.playClip('hop_on')
          this.after(CLIPS.hopOn.duration * 1000, () => {
            this.playClip('sit_down')
            this.after(CLIPS.sitDown.duration * 1000, () => {
              this.dispatch({ type: 'ANIM_DONE', now: Date.now() })
            })
          })
        })
        break
      }

      case 'ready': {
        this.windows.sendToStage(IPC.stageAtSeat, { on: true })
        this.playClip('idle_sit')
        if (this.settings.autoStartNextFocus) {
          this.after(900, () =>
            this.dispatch({ type: 'START', now: Date.now(), focusMs: this.focusMs() })
          )
        }
        break
      }
    }
  }

  // ------------------------------------------------------------------ helpers

  private focusMs(): number {
    return focusMsFor(this.settings)
  }

  private breakMs(): number {
    return breakMsFor(this.settings, this.currentBreakIsLong())
  }

  private currentBreakIsLong(): boolean {
    return isLongBreak(this.state.sessionIndex, durationsFor(this.settings).longEveryN)
  }

  private reduceMotion(): boolean {
    return resolveReduceMotion(this.settings.reduceMotion, this.systemAnimationsEnabled)
  }

  /**
   * 'auto' needs one out-of-process answer from user32. It is asked for only
   * when the setting is 'auto', never blocks the window, and defaults to
   * "animations on" if the query fails.
   */
  private async refreshSystemSettings(): Promise<void> {
    if (this.settings.reduceMotion !== 'auto') {
      this.pushReduceMotion()
      return
    }
    this.systemAnimationsEnabled = await querySystemAnimations()
    this.pushReduceMotion()
  }

  private pushReduceMotion(): void {
    this.windows.sendToStage(IPC.stageReduceMotion, { on: this.reduceMotion() })
  }

  private after(ms: number, fn: () => void): void {
    const handle = setTimeout(() => {
      this.scheduled = this.scheduled.filter((h) => h !== handle)
      fn()
    }, ms)
    this.scheduled.push(handle)
  }

  private clearScheduled(): void {
    for (const handle of this.scheduled) clearTimeout(handle)
    this.scheduled = []
  }

  private playClip(clip: string, crossfade = 0.2): void {
    this.windows.sendToStage(IPC.stagePlayClip, { clip, crossfade })
  }

  private playSound(sound: SoundName): void {
    if (!this.settings.sound) return
    this.windows.sendToStage(IPC.audioPlay, { sound, volume: this.settings.volume / 100 })
  }

  private recordCompletedSession(): void {
    const minutes = Math.max(1, Math.round(this.focusMs() / MINUTES_TO_MS))
    this.store.recordSession(minutes)
    this.pushStats()
  }

  // ------------------------------------------------------------- persistence

  private persistSession(): void {
    this.store.saveSession({
      phase: this.state.phase,
      endsAt: this.state.endsAt,
      pausedAt: this.state.paused ? Date.now() : null,
      pausedRemaining: this.state.paused ? this.state.remainingMs : null,
      sessionIndex: this.state.sessionIndex
    })
  }

  /**
   * Session restore (§6.7): resume an in-flight phase exactly; if it ended
   * while we were away, count the session and land in Ready — never auto-start
   * a break after a crash.
   */
  private restoreSession(): void {
    const saved = this.store.loadSession()
    if (!saved) return
    this.state = next(this.state, { type: 'RESTORE', now: Date.now(), saved })
    if (this.state.phase === 'focus' || this.state.phase === 'break') {
      if (this.state.paused) {
        this.timer.disarm()
      } else {
        this.timer.arm(this.state.endsAt)
      }
      this.enterPhaseOnRestore(this.state.phase)
    } else {
      this.playClip('idle_sit')
    }
  }

  private enterPhaseOnRestore(phase: MachineState['phase']): void {
    if (phase === 'focus') {
      if (this.settings.shadesMode === 'hero') this.playClip('meditate')
      else this.windows.sendToStage(IPC.stageLensFrost, { on: true })
      this.playClip('meditate')
    }
    if (phase === 'break') {
      this.windows.sendToStage(IPC.stageAtSeat, { on: false })
      this.windows.sendToStage(IPC.stageBreakUi, { on: true, long: this.currentBreakIsLong() })
    }
  }

  private applySettings(patch: Partial<Settings>): Settings {
    this.settings = this.store.patchSettings(patch)
    this.state = {
      ...this.state,
      scale: this.settings.scale,
      longEveryN: durationsFor(this.settings).longEveryN
    }
    this.pushSettings()
    this.pushState()
    this.updateTray()
    if ('clickThrough' in patch) {
      // §6.3: with click-through on, even the figure is non-interactive.
      this.windows.sendToStage(IPC.stageHitTestEnable, { on: !this.settings.clickThrough })
      if (this.settings.clickThrough) this.windows.setStageIgnoreMouse(true)
    }
    if ('reduceMotion' in patch) void this.refreshSystemSettings()
    if ('globalShortcut' in patch) this.registerGlobalShortcut()
    if ('launchAtLogin' in patch) this.applyLoginItem()
    if ('lasers' in patch && !this.settings.lasers) this.lasers.reset()
    return this.settings
  }

  private selectDisplay(displayId: number): void {
    const display = resolveDisplay(displayId)
    this.display = display
    this.settings = this.store.patchSettings({ displayId: display.id })
    this.state = {
      ...this.state,
      displayId: display.id,
      petPos: this.store.getPetPosition(display.id, defaultPetPosition(display.workArea))
    }
    this.windows.fitStage(display, { petPos: this.state.petPos, scale: this.state.scale })
    this.windows.ensureLaser(display)
    this.pushState()
    this.pushSettings()
    this.updateTray()
  }

  /**
   * Lasers are off by default and onboarding asks once (§6.5). Rather than a
   * modal, the first launch opens Settings — that is where the choice lives,
   * with the "titles are read in memory and never leave your device" note.
   */
  private maybeOnboard(): void {
    if (this.settings.onboardingDone) return
    this.settings = this.store.patchSettings({ onboardingDone: true })
    this.windows.sendToStage(IPC.stageHitTestEnable, { on: !this.settings.clickThrough })
    this.windows.showSettings()
  }

  /** "Take Bodhi for a walk": a 1/1 demo loop (§6.3). */
  private takeForWalk(): void {
    this.demoPreset = this.settings.preset
    this.applySettings({ preset: 'custom', custom: { focus: 1, shortBreak: 1, longBreak: 1, longEveryN: 4 } })
    this.dispatch({ type: 'RESET', now: Date.now() })
    this.after(200, () =>
      this.dispatch({ type: 'START', now: Date.now(), focusMs: this.focusMs() })
    )
  }

  // ------------------------------------------------------------------ polling

  private onForegroundSample(info: ForegroundInfo | null): void {
    // Fullscreen suppression (§8): a foreground window that covers the display
    // hides the pet but keeps the timer and tray running.
    if (info && this.settings.hideDuringFullscreen) {
      const covering = coversWorkArea(info.bounds, this.display.workArea)
      this.windows.setSuppressed(covering)
    } else if (!info && this.windows.isSuppressed) {
      this.windows.setSuppressed(false)
    }
    this.lasers.handleSample(info)
  }

  private startNudgeRotation(): void {
    if (this.nudgeTimer) clearInterval(this.nudgeTimer)
    this.nudgeTimer = setInterval(() => {
      if (this.state.phase !== 'break') return
      this.nudgeIndex = (this.nudgeIndex + 1) % BREAK_NUDGES.length
      this.windows.sendToStage(IPC.stageNudge, { text: BREAK_NUDGES[this.nudgeIndex] })
    }, 8000)
  }

  // --------------------------------------------------------------- broadcasting

  private pushState(): void {
    const payload = {
      ...this.state,
      petPos: { ...this.state.petPos },
      remainingMs: this.state.endsAt ? Math.max(0, this.state.endsAt - Date.now()) : this.state.remainingMs
    }
    this.windows.broadcast(IPC.stateChanged, payload)
    this.windows.sendToSettings(IPC.stateChanged, payload)
  }

  private broadcastTick(remainingMs: number): void {
    this.windows.broadcast(IPC.timerTick, { remainingMs, phase: this.state.phase })
    this.windows.sendToSettings(IPC.timerTick, { remainingMs, phase: this.state.phase })
    this.updateTrayThrottled()
  }

  private lastTrayUpdate = 0
  private updateTrayThrottled(): void {
    const now = Date.now()
    if (now - this.lastTrayUpdate < 1000) return
    this.lastTrayUpdate = now
    this.updateTray()
  }

  private updateTray(): void {
    this.tray.update({
      phase: this.state.phase,
      paused: this.state.paused,
      remainingMs: this.state.endsAt
        ? Math.max(0, this.state.endsAt - Date.now())
        : this.state.remainingMs,
      settings: this.settings,
      displays: listDisplays(),
      displayId: this.display.id
    })
  }

  private pushSettings(): void {
    this.windows.broadcast(IPC.settingsChanged, this.settings)
    this.windows.sendToSettings(IPC.settingsChanged, this.settings)
  }

  private pushStats(): void {
    const stats = this.store.getStats()
    this.windows.broadcast(IPC.statsChanged, stats)
    this.windows.sendToSettings(IPC.statsChanged, stats)
  }

  // --------------------------------------------------------------------- IPC

  private registerIpc(): void {
    ipcMain.handle(IPC.settingsGet, () => this.settings)
    ipcMain.handle(IPC.settingsSet, (_event, patch: Partial<Settings>) => this.applySettings(patch))
    ipcMain.handle(IPC.statsGet, () => this.store.getStats())
    ipcMain.handle(IPC.displayList, () => listDisplays())
    ipcMain.handle(IPC.stateGet, () => this.state)

    ipcMain.handle(IPC.assetsModel, async (_event, name: 'bodhi' | 'tree') => {
      const file = join(assetsDir(), 'models', `${name}.glb`)
      return new Uint8Array(await readFile(file))
    })

    ipcMain.handle(IPC.assetsSound, async (_event, name: SoundName) => {
      for (const extension of ['ogg', 'wav']) {
        try {
          const file = join(assetsDir(), 'sounds', `${name}.${extension}`)
          return new Uint8Array(await readFile(file))
        } catch {
          // fall through to the next extension
        }
      }
      return new Uint8Array()
    })

    ipcMain.on(IPC.appAction, (_event, action: string, payload?: unknown) =>
      this.handleAction(action, payload)
    )

    ipcMain.on(IPC.stageHover, (_event, hover: { over: boolean; figure: boolean }) => {
      // Click-through when not hovered; the setting can make even the figure
      // non-interactive (§6.3).
      const interactive = hover.over && !this.settings.clickThrough
      this.windows.setStageIgnoreMouse(!interactive)
    })

    ipcMain.on(IPC.stageLens, (_event, lens: { left: PetPosition; right: PetPosition }) => {
      this.lensPositions = lens
    })

    ipcMain.on(IPC.petClick, () => this.onPetClick())
    ipcMain.on(IPC.petDoubleClick, () => this.windows.showSettings())
    ipcMain.on(IPC.petContextMenu, () => this.tray.showMenu())
    ipcMain.on(IPC.petDragStart, (_event, offset: PetPosition) => this.beginDrag(offset))
    ipcMain.on(IPC.petDragEnd, () => this.endDrag())

    ipcMain.on(IPC.stageReady, () => this.onStageReady())
  }

  /**
   * The stage pulls state and settings itself on boot, but anything main pushed
   * *before* the renderer finished loading its models was dropped on the floor
   * — the listener did not exist yet. Re-assert the view from the state we
   * already have. No sounds, no timers, no transitions: this is a repaint, not
   * a re-entry.
   */
  private onStageReady(): void {
    this.pushReduceMotion()
    this.windows.sendToStage(IPC.stageHitTestEnable, { on: !this.settings.clickThrough })
    this.windows.sendToStage(IPC.stageBloom, { stage: this.state.bloomStage })

    switch (this.state.phase) {
      case 'focus':
        if (this.settings.shadesMode === 'frost') {
          this.windows.sendToStage(IPC.stageLensFrost, { on: true })
        }
        this.playClip('meditate')
        break
      case 'break':
        this.windows.sendToStage(IPC.stageAtSeat, { on: false })
        this.windows.sendToStage(IPC.stageBreakUi, { on: true, long: this.currentBreakIsLong() })
        break
      case 'idle':
      case 'ready':
        this.windows.sendToStage(IPC.stageAtSeat, { on: true })
        this.playClip('idle_sit')
        break
      default:
        break
    }
  }

  private handleAction(action: string, payload?: unknown): void {
    switch (action) {
      case 'start':
        this.dispatch({ type: 'START', now: Date.now(), focusMs: this.focusMs() })
        break
      case 'pause':
        this.dispatch({ type: 'PAUSE', now: Date.now() })
        break
      case 'resume':
        this.dispatch({ type: 'RESUME', now: Date.now() })
        break
      case 'skip':
        this.dispatch({ type: 'SKIP', now: Date.now(), breakMs: this.breakMs() })
        break
      case 'reset':
        this.restorePresetAfterDemo()
        this.dispatch({ type: 'RESET', now: Date.now() })
        break
      case 'open-settings':
        this.windows.showSettings()
        break
      case 'take-walk':
        this.takeForWalk()
        break
      case 'quit':
        app.quit()
        break
      case 'set-display':
        this.selectDisplay(Number(payload))
        break
      case 'set-preset':
        this.applySettings({ preset: String(payload) as Settings['preset'] })
        break
      case 'snooze-lasers':
        this.applySettings({ laserSnoozeUntil: this.lasers.snooze(15) })
        break
      case 'save-settings':
        this.dispatch({ type: 'REFOCUSED', now: Date.now() })
        this.playClip('nod')
        break
      default:
        break
    }
  }

  private restorePresetAfterDemo(): void {
    if (this.demoPreset) {
      const preset = this.demoPreset
      this.demoPreset = null
      this.applySettings({ preset })
    }
  }

  /**
   * Left click: start / pause / resume (§6.2). Debounced by 250 ms so a
   * double-click opens Settings instead of firing start -> pause -> settings.
   */
  private onPetClick(): void {
    if (this.clickDebounce) {
      clearTimeout(this.clickDebounce)
      this.clickDebounce = null
      this.windows.showSettings()
      return
    }
    this.clickDebounce = setTimeout(() => {
      this.clickDebounce = null
      this.handleAction(
        this.state.phase === 'focus' || this.state.phase === 'break'
          ? this.state.paused
            ? 'resume'
            : 'pause'
          : 'start'
      )
    }, SIZES.clickDebounceMs)
  }

  // -------------------------------------------------------------------- drag

  private beginDrag(offset: PetPosition): void {
    this.dragOffset = offset
    if (this.dragPoller) clearInterval(this.dragPoller)
    this.dragPoller = setInterval(() => this.pollDrag(), Math.round(1000 / SIZES.dragPollHz))
  }

  private endDrag(): void {
    if (this.dragPoller) {
      clearInterval(this.dragPoller)
      this.dragPoller = null
    }
    this.store.setPetPosition(this.display.id, this.state.petPos)
    this.pushSettings()
  }

  /** Poll the cursor at ~30 Hz: move the pet, and switch displays on the way. */
  private pollDrag(): void {
    const cursor = this.windows.cursorScreenPoint()
    const target = displayContaining(cursor, allDisplays())
    if (target != null && target !== this.display.id) {
      const next = allDisplays().find((d) => d.id === target)
      if (next) {
        // Crossing into another display: re-fit the stage there and restore
        // that display's saved position. Timer state is untouched (§5.6).
        this.display = next
        this.settings = this.store.patchSettings({ displayId: next.id })
        this.state = {
          ...this.state,
          displayId: next.id,
          petPos: this.store.getPetPosition(next.id, defaultPetPosition(next.workArea))
        }
        this.windows.fitStage(next, { petPos: this.state.petPos, scale: this.state.scale })
        this.windows.ensureLaser(next)
        this.pushState()
        this.updateTray()
        return
      }
    }
    const position = clampToWorkArea(
      { x: cursor.x - this.dragOffset.x, y: cursor.y - this.dragOffset.y },
      this.display.workArea
    )
    if (position.x !== this.state.petPos.x || position.y !== this.state.petPos.y) {
      this.state = { ...this.state, petPos: position }
      this.pushState()
    }
  }

  // ---------------------------------------------------------------- platform

  private registerGlobalShortcut(): void {
    globalShortcut.unregisterAll()
    const accelerator = this.settings.globalShortcut
    if (!accelerator) return
    try {
      globalShortcut.register(accelerator, () => {
        if (this.state.phase === 'idle' || this.state.phase === 'ready') {
          this.handleAction('start')
        } else if (this.state.phase === 'focus' || this.state.phase === 'break') {
          this.handleAction(this.state.paused ? 'resume' : 'pause')
        }
      })
    } catch {
      // An invalid accelerator must never break startup.
    }
  }

  private registerPowerMonitor(): void {
    // Sleep/lock: the countdown is an absolute end time, so we only need to
    // reconcile once when the machine wakes (§6.1, §8).
    powerMonitor.on('resume', () => this.timer.reconcile())
    powerMonitor.on('unlock-screen', () => this.timer.reconcile())
    powerMonitor.on('suspend', () => this.timer.poke())
  }

  private registerDisplayEvents(): void {
    const refit = (): void => {
      const current = resolveDisplay(this.settings.displayId)
      const unplugged = !allDisplays().some((d) => d.id === this.display.id)
      this.display = current
      if (unplugged) {
        // Selected monitor disappeared: migrate to primary, keep the timer (§6.7)
        this.state = {
          ...this.state,
          displayId: current.id,
          petPos: this.store.getPetPosition(current.id, defaultPetPosition(current.workArea))
        }
      }
      this.windows.fitStage(current, { petPos: this.state.petPos, scale: this.state.scale })
      this.windows.ensureLaser(current)
      this.pushState()
      this.updateTray()
    }
    screen.on('display-metrics-changed', refit)
    screen.on('display-added', refit)
    screen.on('display-removed', refit)
  }

  private applyLoginItem(): void {
    app.setLoginItemSettings({ openAtLogin: this.settings.launchAtLogin })
  }

  /**
   * Auto-update (§7.7): installed builds update silently; the portable build
   * cannot replace itself, so it shows a toast with a download link instead.
   */
  private async setupUpdater(): Promise<void> {
    if (!app.isPackaged || process.env['VITE_DEV_SERVER_URL']) return
    try {
      const { autoUpdater } = await import('electron-updater')
      autoUpdater.autoDownload = !process.env['PORTABLE_EXECUTABLE_DIR']
      autoUpdater.autoInstallOnAppQuit = !process.env['PORTABLE_EXECUTABLE_DIR']
      await autoUpdater.checkForUpdatesAndNotify()
    } catch {
      // Updates are best-effort; a failure here must never block the app.
    }
  }
}

function assetsDir(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'assets')
    : join(app.getAppPath(), 'assets')
}

// ---------------------------------------------------------------- app bootstrap

const bodhi = new BodhiApp()

app.on('window-all-closed', (): void => {
  // The pet lives in the tray: closing windows never quits on Windows.
})

app.on('before-quit', (): void => {
  globalShortcut.unregisterAll()
})

app.on('activate', (): void => {
  bodhi.show()
})

void bodhi.boot()

export type { BodhiApp }
export { assetsDir }
