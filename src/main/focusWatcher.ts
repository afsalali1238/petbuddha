import { WATCHER } from '@shared/constants'

/**
 * Foreground-window polling (§6.5, §8).
 *
 * One 1.5 s poll feeds both the distraction watcher and fullscreen suppression,
 * so the app never polls the window manager more often than that — partly for
 * CPU, partly because active-window polling looks spyware-ish to antivirus and
 * the promise we make users is "read in memory, never logged, never sent".
 *
 * get-windows is ESM-only, so it is imported dynamically (§7.1).
 */
export interface ForegroundInfo {
  title: string
  processName: string
  appName: string
  url: string | null
  bounds: { x: number; y: number; width: number; height: number }
}

type ActiveWindow = {
  title?: string
  id?: number
  bounds?: { x: number; y: number; width: number; height: number }
  owner?: { name?: string; path?: string; processId?: number }
  url?: string | null
}

export class FocusWatcher {
  private timer: NodeJS.Timeout | null = null
  private running = false
  private modulePromise: Promise<{ activeWindow: (options?: unknown) => Promise<ActiveWindow | undefined> }> | null =
    null

  constructor(
    private readonly onSample: (info: ForegroundInfo | null) => void,
    private readonly intervalMs: number = WATCHER.pollMs
  ) {}

  /** Loaded lazily and once; a missing native binary must never crash the app. */
  private loader(): Promise<{ activeWindow: (options?: unknown) => Promise<ActiveWindow | undefined> }> {
    if (!this.modulePromise) {
      this.modulePromise = import('get-windows') as Promise<{
        activeWindow: (options?: unknown) => Promise<ActiveWindow | undefined>
      }>
    }
    return this.modulePromise
  }

  async sample(): Promise<ForegroundInfo | null> {
    try {
      const { activeWindow } = await this.loader()
      const window = await activeWindow({ accessibilityPermission: false, screenRecordingPermission: false })
      if (!window) return null
      const path = window.owner?.path ?? ''
      const processName = path.split(/[\\/]/).pop() ?? window.owner?.name ?? ''
      return {
        title: window.title ?? '',
        processName,
        appName: window.owner?.name ?? processName,
        url: window.url ?? null,
        bounds: window.bounds ?? { x: 0, y: 0, width: 0, height: 0 }
      }
    } catch {
      // Native module unavailable (or permission denied): degrade quietly.
      return null
    }
  }

  start(): void {
    if (this.running) return
    this.running = true
    const tick = async (): Promise<void> => {
      if (!this.running) return
      const info = await this.sample()
      if (this.running) this.onSample(info)
    }
    void tick()
    this.timer = setInterval(() => void tick(), this.intervalMs)
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  get isRunning(): boolean {
    return this.running
  }
}

/** Does this window cover (essentially) the whole work area? (§8) */
export function coversWorkArea(
  bounds: { x: number; y: number; width: number; height: number },
  workArea: { x: number; y: number; width: number; height: number },
  tolerancePx = 4
): boolean {
  if (bounds.width <= 0 || bounds.height <= 0) return false
  return (
    bounds.x <= workArea.x + tolerancePx &&
    bounds.y <= workArea.y + tolerancePx &&
    bounds.x + bounds.width >= workArea.x + workArea.width - tolerancePx &&
    bounds.y + bounds.height >= workArea.y + workArea.height - tolerancePx
  )
}
