import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/ipc'
import type { AudioPlayPayload, DisplayChangedPayload, HoverPayload, LensPayload, Unsubscribe } from '@shared/ipc'
import type {
  AppState,
  BlastPayload,
  DisplayInfo,
  PlayClipPayload,
  Settings,
  SoundName,
  Stats,
  WalkPathPayload
} from '@shared/types'

/**
 * The only bridge between the renderers and the main process (§7.2):
 * contextIsolation on, nodeIntegration off, one typed surface.
 */
function listener(channel: string) {
  return (callback: (...args: never[]) => void): Unsubscribe => {
    const handler = (_event: unknown, ...args: unknown[]): void => callback(...(args as never[]))
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

const base = {
  getState: (): Promise<AppState> => ipcRenderer.invoke(IPC.stateGet),
  getSettings: (): Promise<Settings> => ipcRenderer.invoke(IPC.settingsGet),
  setSettings: (patch: Partial<Settings>): Promise<Settings> =>
    ipcRenderer.invoke(IPC.settingsSet, patch),
  getStats: (): Promise<Stats> => ipcRenderer.invoke(IPC.statsGet),
  action: (action: string, payload?: unknown): Promise<void> =>
    ipcRenderer.invoke(IPC.appAction, action, payload),
  loadModel: (name: 'bodhi' | 'tree'): Promise<ArrayBuffer> =>
    ipcRenderer.invoke(IPC.assetsModel, name),
  loadSound: (name: SoundName): Promise<ArrayBuffer> =>
    ipcRenderer.invoke(IPC.assetsSound, name),
  onState: listener(IPC.stateChanged),
  onTimerTick: listener(IPC.timerTick),
  onSettingsChanged: listener(IPC.settingsChanged),
  onStatsChanged: listener(IPC.statsChanged),
  onDisplayChanged: listener(IPC.displayChanged),
  onTrayUpdate: listener(IPC.trayUpdate),
  onAudioPlay: listener(IPC.audioPlay)
}

const stage = {
  onPlayClip: listener(IPC.stagePlayClip) as (
    callback: (payload: PlayClipPayload) => void
  ) => Unsubscribe,
  onWalkPath: listener(IPC.stageWalkPath) as (
    callback: (payload: WalkPathPayload) => void
  ) => Unsubscribe,
  onHitTestEnable: listener(IPC.stageHitTestEnable),
  onTimeOfDay: listener(IPC.timeOfDay),
  onNudge: listener(IPC.stageNudge),
  onAtSeat: listener(IPC.stageAtSeat),
  onBreakUi: listener(IPC.stageBreakUi),
  onBloom: listener(IPC.stageBloom),
  onLensFrost: listener(IPC.stageLensFrost),
  onShake: listener(IPC.stageShake),
  onPill: listener(IPC.stagePill),
  setHover: (payload: HoverPayload): void => ipcRenderer.send(IPC.stageHover, payload),
  setLensPositions: (payload: LensPayload): void => ipcRenderer.send(IPC.stageLens, payload),
  dragStart: (payload: { x: number; y: number }): void =>
    ipcRenderer.send(IPC.petDragStart, payload),
  dragMove: (payload: { x: number; y: number }): void => ipcRenderer.send(IPC.stageHover, payload),
  dragEnd: (payload: { x: number; y: number }): void => ipcRenderer.send(IPC.petDragEnd, payload),
  petClick: (): void => ipcRenderer.send(IPC.petClick),
  petDoubleClick: (): void => ipcRenderer.send(IPC.petDoubleClick),
  contextMenu: (): void => ipcRenderer.send(IPC.petContextMenu),
  ready: (): void => ipcRenderer.send(IPC.stageReady)
}

const laser = {
  onBlastFire: listener(IPC.blastFire) as (callback: (payload: BlastPayload) => void) => Unsubscribe,
  onBlastStop: listener(IPC.blastStop) as (callback: () => void) => Unsubscribe
}

const settings = {
  getDisplays: (): Promise<DisplayInfo[]> => ipcRenderer.invoke(IPC.displayList),
  onDisplays: listener(IPC.displayList)
}

const api = { ...base, ...stage, ...laser, ...settings }

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
}

export type Api = typeof api
export type { AudioPlayPayload, DisplayChangedPayload, BlastPayload, WalkPathPayload }
