/**
 * Sound synthesis (§9 budget line: sounds $0).
 *
 * These are original, procedurally generated samples, so they are unencumbered
 * — no freesound download, no licence to chase. They are written as 16-bit PCM
 * WAV because this environment cannot encode Vorbis; the loader prefers .ogg
 * when present, so dropping in real CC0 recordings later is a file swap.
 *
 * bell.ogg      temple bell, ~4 s decay (§2.1)
 * soft-bell.ogg the gentler return bell
 * pew.ogg       laser blast
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(here, '../assets/sounds')
const RATE = 22050

function writeWav(path, samples) {
  const buffer = Buffer.alloc(44 + samples.length * 2)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + samples.length * 2, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16) // PCM chunk size
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(RATE, 24)
  buffer.writeUInt32LE(RATE * 2, 28) // byte rate
  buffer.writeUInt16LE(2, 32) // block align
  buffer.writeUInt16LE(16, 34) // bits
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples.length * 2, 40)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2)
  }
  writeFileSync(path, buffer)
  console.log(`${path.split('/').pop()}  ${(buffer.length / 1024).toFixed(1)} KB  ${(samples.length / RATE).toFixed(2)}s`)
}

/**
 * Additive bell: a strike transient plus inharmonic partials, each with its own
 * exponential decay. Inharmonicity is what makes metal sound like metal.
 */
function bell({ seconds = 4, base = 220, partials, brightness = 1, strike = 0.006 }) {
  const length = Math.floor(RATE * seconds)
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    const t = i / RATE
    let value = 0
    for (const partial of partials) {
      const decay = Math.exp(-t / partial.decay)
      if (decay < 1e-4) continue
      value += partial.gain * decay * Math.sin(2 * Math.PI * base * partial.ratio * t + partial.phase)
    }
    // strike: a short burst of filtered noise at the very start
    if (t < strike) {
      const envelope = 1 - t / strike
      value += (Math.random() * 2 - 1) * envelope * 0.35 * brightness
    }
    // gentle amplitude beating, so the tail breathes
    const shimmer = 1 + 0.06 * Math.sin(2 * Math.PI * 1.7 * t)
    out[i] = value * 0.42 * shimmer * Math.exp(-t * 0.05)
  }
  return out
}

/** Descending zap for the laser (§6.5). */
function pew({ seconds = 0.35 } = {}) {
  const length = Math.floor(RATE * seconds)
  const out = new Float32Array(length)
  let phase = 0
  for (let i = 0; i < length; i++) {
    const t = i / RATE
    const progress = t / seconds
    const frequency = 1400 * (1 - 0.85 * progress) + 60
    phase += (2 * Math.PI * frequency) / RATE
    const envelope = Math.exp(-t * 7) * (1 - progress)
    out[i] = (Math.sin(phase) * 0.6 + Math.sin(phase * 2.01) * 0.2) * envelope * 0.5
  }
  return out
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  // Temple bell: struck low, long tail, a few inharmonic partials (§2.1 "4 s decay").
  const templeBell = bell({
    seconds: 4,
    base: 196,
    brightness: 1,
    partials: [
      { ratio: 0.5, gain: 0.5, decay: 3.4, phase: 0 },
      { ratio: 1.0, gain: 1.0, decay: 2.6, phase: 0.2 },
      { ratio: 1.51, gain: 0.44, decay: 1.7, phase: 0.6 },
      { ratio: 2.02, gain: 0.32, decay: 1.1, phase: 1.1 },
      { ratio: 2.71, gain: 0.18, decay: 0.7, phase: 0.3 },
      { ratio: 4.13, gain: 0.09, decay: 0.45, phase: 1.7 }
    ]
  })
  writeWav(join(OUT_DIR, 'bell.wav'), templeBell)

  // The return bell is smaller and higher: he is coming home, not leaving.
  const softBell = bell({
    seconds: 2.2,
    base: 392,
    brightness: 0.6,
    partials: [
      { ratio: 1.0, gain: 0.9, decay: 1.4, phase: 0 },
      { ratio: 1.68, gain: 0.4, decay: 0.8, phase: 0.4 },
      { ratio: 2.44, gain: 0.22, decay: 0.5, phase: 0.9 },
      { ratio: 3.61, gain: 0.1, decay: 0.3, phase: 1.4 }
    ]
  })
  writeWav(join(OUT_DIR, 'soft-bell.wav'), softBell)

  writeWav(join(OUT_DIR, 'pew.wav'), pew())
}

main()
