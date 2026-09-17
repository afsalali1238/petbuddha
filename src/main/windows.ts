import { BrowserWindow, app, screen } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { IPC } from '@shared/ipc'
import type { BlastPayload, PetPosition } from '@shared/types'
import type { DisplayEntry } from './displays'

/**
 * Window lifecycle (§5.1).
 *
 * The Stage is the single persistent window: full work area, transparent,
 * always on top at screen-saver level, click-through by default. Everything 3D
 * renders inside it — the diorama and the walking Buddha — so no OS window ever
 * moves during a walk.
 */
const SETTINGS_SIZE = { width: 400, height: 640 }

function rendererUrl(entry: 'stage' | 'laser' | 'settings'): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (is.dev && devUrl) {
    return `${devUrl}/${entry}/index.html`
  }
  return `file://${join(__dirname, `../renderer/${entry}/index.html`)}`
}

function preloadPath(): string {
  return join(__dirname, '../preload/index.js')
}

function baseWebPreferences() {
  return {
    preload: preloadPath(),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: false,
    backgroundThrottling: false,
    spellcheck: false
  }
}

export class WindowManager {
  private stage: BrowserWindow | null = null
  private laser: BrowserWindow | null = null
  private settingsWindow: BrowserWindow | null = null
  private suppressed = false

  get stageWindow(): BrowserWindow | null {
    return this.stage
  }

  get settingsWindowHandle(): BrowserWindow | null {
    return this.settingsWindow
  }

  createStage(display: DisplayEntry): BrowserWindow {
    const { x, y, width, height } = display.workArea

    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      hasShadow: false,
      skipTaskbar: true,
      focusable: false,
      fullscreenable: false,
      acceptFirstMouse: true,
      webPreferences: baseWebPreferences()
    })

    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false })
    // Clicks fall through until the renderer's hit-test says the pointer is on
    // the figure (§5.5).
    win.setIgnoreMouseEvents(true, { forward: true })

    win.on('closed', () => {
      if (this.stage === win) this.stage = null
    })

    this.stage = win
    void win.loadURL(rendererUrl('stage'))
    return win
  }

  /**
   * Re-fit the stage after a display change or a mixed-DPI move (§8), and tell
   * the renderer its new coordinate frame.
   */
  fitStage(display: DisplayEntry, extra: { petPos?: PetPosition; scale?: number } = {}): void {
    const { x, y, width, height } = display.workArea
    if (this.stage) {
      // Move before resize: crossing DPI boundaries mid-resize is what makes
      // transparent windows jump.
      this.stage.setBounds({ x, y, width, height }, false)
    }
    this.stage?.webContents.send(IPC.displayChanged, {
      displayId: display.id,
      workArea: display.workArea,
      scaleFactor: display.scaleFactor,
      petPos: extra.petPos,
      scale: extra.scale
    })
  }

  /** Toggle click-through from the renderer's hit-test (§5.5). */
  setStageIgnoreMouse(ignore: boolean): void {
    this.stage?.setIgnoreMouseEvents(ignore, { forward: true })
  }

  showStage(): void {
    if (this.stage && !this.stage.isVisible()) this.stage.showInactive()
  }

  hideStage(): void {
    if (this.stage?.isVisible()) this.stage.hide()
  }

  /** Fullscreen suppression: hide the pet, keep the timer and tray alive (§8). */
  setSuppressed(suppressed: boolean): void {
    if (suppressed === this.suppressed) return
    this.suppressed = suppressed
    if (suppressed) {
      this.hideStage()
      this.blastStop()
    } else {
      this.showStage()
    }
    this.broadcast(IPC.stateChanged, undefined)
  }

  get isSuppressed(): boolean {
    return this.suppressed
  }

  // --- laser overlay (§6.6) -------------------------------------------------

  ensureLaser(display: DisplayEntry): BrowserWindow {
    if (this.laser && !this.laser.isDestroyed()) {
      const { x, y, width, height } = display.workArea
      this.laser.setBounds({ x, y, width, height }, false)
      return this.laser
    }
    const { x, y, width, height } = display.workArea
    const win = new BrowserWindow({
      x,
      y,
      width,
      height,
      transparent: true,
      frame: false,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      focusable: false,
      fullscreenable: false,
      hasShadow: false,
      webPreferences: baseWebPreferences()
    })
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setIgnoreMouseEvents(true)
    win.hide()
    this.laser = win
    void win.loadURL(rendererUrl('laser'))
    return win
  }

  fireBlast(payload: BlastPayload): void {
    const win = this.laser
    if (!win || this.suppressed) return
    win.setIgnoreMouseEvents(true)
    win.showInactive()
    win.webContents.send(IPC.blastFire, payload)
  }

  blastStop(): void {
    if (!this.laser || this.laser.isDestroyed()) return
    this.laser.webContents.send(IPC.blastStop)
    this.laser.hide()
  }

  // --- settings -------------------------------------------------------------

  showSettings(): void {
    if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
      this.settingsWindow.focus()
      return
    }
    const win = new BrowserWindow({
      width: SETTINGS_SIZE.width,
      height: SETTINGS_SIZE.height,
      resizable: false,
      title: 'Bodhi Pomodoro',
      autoHideMenuBar: true,
      webPreferences: baseWebPreferences()
    })
    win.setMenuBarVisibility(false)
    this.settingsWindow = win
    win.on('closed', () => {
      this.settingsWindow = null
    })
    void win.loadURL(rendererUrl('settings'))
  }

  closeSettings(): void {
    this.settingsWindow?.close()
  }

  // --- helpers --------------------------------------------------------------

  broadcast(channel: string, payload?: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win === this.settingsWindow) continue
      win.webContents.send(channel, payload)
    }
  }

  sendToStage(channel: string, payload?: unknown): void {
    this.stage?.webContents.send(channel, payload)
  }

  sendToSettings(channel: string, payload?: unknown): void {
    this.settingsWindow?.webContents.send(channel, payload)
  }

  /** Cursor position in screen DIP (§5.6 drag polling). */
  cursorScreenPoint(): PetPosition {
    return screen.getCursorScreenPoint()
  }

  destroyAll(): void {
    this.stage?.destroy()
    this.laser?.destroy()
    this.settingsWindow?.destroy()
  }
}

/**
 * Driver workarounds for Intel/old GPUs that render transparent WebGL windows
 * black (§8). Applied before app ready and requiring a relaunch, so they are
 * driven by the `renderingFix` setting.
 */
export function applyRenderingFix(fix: string): void {
  switch (fix) {
    case 'angle-d3d11':
      app.commandLine.appendSwitch('use-angle', 'd3d11')
      break
    case 'disable-gpu-compositing':
      app.commandLine.appendSwitch('use-angle', 'd3d11')
      app.commandLine.appendSwitch('disable-gpu-compositing')
      break
    case 'disable-hw-accel':
      app.disableHardwareAcceleration()
      break
    default:
      break
  }
}
