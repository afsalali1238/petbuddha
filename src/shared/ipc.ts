import type {
  AppState,
  BlastPayload,
  DisplayInfo,
  PetPosition,
  PlayClipPayload,
  Settings,
  SoundName,
  Stats,
  TrayUpdate,
  WalkPathPayload
} from './types'

/**
 * IPC channel names are a fixed contract (§7.4). The names marked "core" are
 * quoted verbatim from the spec and must never be renamed.
 */
export const IPC = {
  // ---- core channels (§7.4) -------------------------------------------------
  stateChanged: 'state:changed',
  timerTick: 'timer:tick',
  stagePlayClip: 'stage:play-clip',
  stageWalkPath: 'stage:walk-path',
  stageHitTestEnable: 'stage:hit-test-enable',
  blastFire: 'blast:fire',
  blastStop: 'blast:stop',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  displayChanged: 'display:changed',
  trayUpdate: 'tray:update',

  // ---- supporting channels --------------------------------------------------
  stateGet: 'state:get',
  settingsChanged: 'settings:changed',
  statsGet: 'stats:get',
  statsChanged: 'stats:changed',
  audioPlay: 'audio:play',
  assetsModel: 'assets:model',
  assetsSound: 'assets:sound',
  appAction: 'app:action',
  stageHover: 'stage:hover',
  stageAtSeat: 'stage:at-seat',
  stageBreakUi: 'stage:break-ui',
  stageBloom: 'stage:bloom',
  stageLensFrost: 'stage:lens-frost',
  stageReduceMotion: 'stage:reduce-motion',
  stageShake: 'stage:shake',
  stagePill: 'stage:pill',
  petClick: 'pet:click',
  petDoubleClick: 'pet:double-click',
  petContextMenu: 'pet:context-menu',
  petDragStart: 'pet:drag-start',
  petDragEnd: 'pet:drag-end',
  stageLens: 'stage:lens',
  stageReady: 'stage:ready',
  stageNudge: 'stage:nudge',
  displayList: 'display:list',
  timeOfDay: 'stage:time-of-day',
  onboarding: 'onboarding:ask-lasers'
} as const

export type AppAction =
  | 'start'
  | 'pause'
  | 'resume'
  | 'skip'
  | 'reset'
  | 'open-settings'
  | 'take-walk'
  | 'quit'
  | 'snooze-lasers'
  | string

export interface DisplayChangedPayload {
  displayId: number
  workArea: { x: number; y: number; width: number; height: number }
  scaleFactor: number
  petPos: PetPosition
  scale: number
}

export interface AudioPlayPayload {
  sound: SoundName
  volume: number
}

export interface HoverPayload {
  over: boolean
  /** true when the pointer is over the figure rather than the diorama */
  figure: boolean
  /** cursor position in window DIP */
  x: number
  y: number
}

export interface LensPayload {
  left: PetPosition
  right: PetPosition
}

export type Unsubscribe = () => void

/** Common surface exposed on every window's `window.api`. */
export interface BaseApi {
  getState(): Promise<AppState>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  getStats(): Promise<Stats>
  action(action: AppAction, payload?: unknown): Promise<void>
  loadModel(name: 'bodhi' | 'tree'): Promise<ArrayBuffer>
  loadSound(name: SoundName): Promise<ArrayBuffer>
  onState(listener: (state: AppState) => void): Unsubscribe
  onTimerTick(listener: (payload: { remainingMs: number | null; phase: string }) => void): Unsubscribe
  onSettingsChanged(listener: (settings: Settings) => void): Unsubscribe
  onStatsChanged(listener: (stats: Stats) => void): Unsubscribe
  onDisplayChanged(listener: (payload: DisplayChangedPayload) => void): Unsubscribe
  onTrayUpdate(listener: (payload: TrayUpdate) => void): Unsubscribe
  onAudioPlay(listener: (payload: AudioPlayPayload) => void): Unsubscribe
}

/** Surface exposed on the stage window. */
export interface StageApi extends BaseApi {
  onPlayClip(listener: (payload: PlayClipPayload) => void): Unsubscribe
  onWalkPath(listener: (payload: WalkPathPayload) => void): Unsubscribe
  onHitTestEnable(listener: (payload: { on: boolean }) => void): Unsubscribe
  onTimeOfDay(listener: (payload: { timeOfDay: string; reduceMotion: boolean }) => void): Unsubscribe
  onNudge(listener: (payload: { text: string }) => void): Unsubscribe
  onAtSeat(listener: (payload: { on: boolean }) => void): Unsubscribe
  onBreakUi(listener: (payload: { on: boolean; long: boolean }) => void): Unsubscribe
  onBloom(listener: (payload: { stage: 0 | 1 | 2 | 3 | 4 }) => void): Unsubscribe
  onLensFrost(listener: (payload: { on: boolean }) => void): Unsubscribe
  /** main's resolved reduce-motion boolean (the setting can be 'auto', §6.3) */
  onReduceMotion(listener: (payload: { on: boolean }) => void): Unsubscribe
  onShake(listener: (payload: { px: number; ms: number }) => void): Unsubscribe
  onPill(listener: (payload: { text: string; x: number; y: number }) => void): Unsubscribe
  setHover(payload: HoverPayload): void
  setLensPositions(payload: LensPayload): void
  dragStart(payload: { x: number; y: number }): void
  dragMove(payload: { x: number; y: number }): void
  dragEnd(payload: { x: number; y: number }): void
  petClick(): void
  petDoubleClick(): void
  contextMenu(): void
  ready(): void
}

/** Surface exposed on the laser overlay window. */
export interface LaserApi extends BaseApi {
  onBlastFire(listener: (payload: BlastPayload) => void): Unsubscribe
  onBlastStop(listener: () => void): Unsubscribe
}

/** Surface exposed on the settings window. */
export interface SettingsApi extends BaseApi {
  getDisplays(): Promise<DisplayInfo[]>
  onDisplays(listener: (displays: DisplayInfo[]) => void): Unsubscribe
}

declare global {
  interface Window {
    api: StageApi & LaserApi & SettingsApi
  }
}
