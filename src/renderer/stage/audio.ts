import type { SoundName } from '@shared/types'

/**
 * Tiny sound bank. Clips are fetched from the main process as raw bytes (so the
 * packaged app never has to fight file:// CORS) and decoded once.
 */
export class SoundBank {
  private context: AudioContext | null = null
  private buffers = new Map<SoundName, AudioBuffer>()
  private pending = new Map<SoundName, Promise<AudioBuffer | null>>()

  private ensureContext(): AudioContext | null {
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      if (!Ctor) return null
      this.context = new Ctor()
    }
    return this.context
  }

  preload(names: SoundName[]): void {
    for (const name of names) void this.load(name)
  }

  private async load(name: SoundName): Promise<AudioBuffer | null> {
    const existing = this.buffers.get(name)
    if (existing) return existing
    const inFlight = this.pending.get(name)
    if (inFlight) return inFlight

    const task = (async (): Promise<AudioBuffer | null> => {
      try {
        const bytes = await window.api.loadSound(name)
        if (!bytes || bytes.byteLength === 0) return null
        const context = this.ensureContext()
        if (!context) return null
        const buffer = await context.decodeAudioData(bytes.slice(0))
        this.buffers.set(name, buffer)
        return buffer
      } catch {
        return null
      } finally {
        this.pending.delete(name)
      }
    })()

    this.pending.set(name, task)
    return task
  }

  async play(name: SoundName, volume = 0.6): Promise<void> {
    const buffer = await this.load(name)
    if (!buffer) return
    const context = this.ensureContext()
    if (!context) return
    if (context.state === 'suspended') void context.resume()
    const source = context.createBufferSource()
    const gain = context.createGain()
    gain.gain.value = Math.max(0, Math.min(1, volume))
    source.buffer = buffer
    source.connect(gain).connect(context.destination)
    source.start()
  }
}
