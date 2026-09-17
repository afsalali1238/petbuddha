/**
 * Tray + app icons, drawn procedurally (no binary assets in the repo, no
 * external art). The tray glyph is the Buddha's silhouette: head, topknot,
 * ears and the shades band — the four things that make him readable at 16 px.
 *
 * Writes assets/icons/tray-{16,24,32,64,256}.png and assets/icons/icon.ico.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

import { PALETTE } from '../src/shared/palette.ts'

const here = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(here, '../assets/icons')
const SS = 4 // supersampling

const hex = (value) => {
  const int = parseInt(value.replace('#', ''), 16)
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255, a: 255 }
}

const SKIN = hex(PALETTE.skinBase)
const INK = hex(PALETTE.outline)

/** Signed-distance-ish coverage for the icon shapes, in a 0..1 unit square. */
function headDistance(x, y) {
  // head: squashed circle centred slightly low
  const dx = (x - 0.5) / 0.31
  const dy = (y - 0.56) / 0.30
  return Math.sqrt(dx * dx + dy * dy) - 1
}

function topknotDistance(x, y) {
  const dx = (x - 0.5) / 0.115
  const dy = (y - 0.155) / 0.10
  return Math.sqrt(dx * dx + dy * dy) - 1
}

function earDistance(x, y, side) {
  const dx = (x - (0.5 + side * 0.29)) / 0.075
  const dy = (y - 0.56) / 0.115
  return Math.sqrt(dx * dx + dy * dy) - 1
}

function shadesBand(x, y) {
  // the signature: two lenses joined by a bridge
  const inLeft = Math.hypot((x - 0.375) / 0.115, (y - 0.545) / 0.075) < 1
  const inRight = Math.hypot((x - 0.625) / 0.115, (y - 0.545) / 0.075) < 1
  const inBridge = Math.abs(y - 0.535) < 0.018 && x > 0.42 && x < 0.58
  return inLeft || inRight || inBridge
}

function coverage(x, y) {
  const shapes = [
    headDistance(x, y),
    topknotDistance(x, y),
    earDistance(x, y, -1),
    earDistance(x, y, 1)
  ]
  return Math.min(...shapes)
}

/** Render the glyph at an arbitrary size with 4x supersampling. */
function renderGlyph(size) {
  const png = new PNG({ width: size, height: size })
  const supersampled = size * SS
  const accumulator = new Float32Array(size * size * 4)

  for (let sy = 0; sy < supersampled; sy++) {
    for (let sx = 0; sx < supersampled; sx++) {
      const x = (sx + 0.5) / supersampled
      const y = (sy + 0.5) / supersampled
      const d = coverage(x, y)

      // ~1.5 px of outline, expressed in the shape's normalised distance units
      // (the head radius is 0.31 of the icon, so 1 px ~= 3.2 / size)
      const edge = 4.8 / size
      const insideOutline = d < 0
      const insideInk = d < -edge

      let color = null
      if (insideOutline) {
        color = insideInk ? (shadesBand(x, y) ? INK : SKIN) : INK
      }
      if (!color) continue

      const px = Math.floor(sx / SS)
      const py = Math.floor(sy / SS)
      const i = (py * size + px) * 4
      accumulator[i + 0] += color.r
      accumulator[i + 1] += color.g
      accumulator[i + 2] += color.b
      accumulator[i + 3] += color.a
    }
  }

  const samples = SS * SS
  for (let i = 0; i < size * size; i++) {
    const o = i * 4
    const a = accumulator[o + 3] / samples
    png.data[o + 0] = Math.round(accumulator[o + 0] / samples / (a / 255 || 1))
    png.data[o + 1] = Math.round(accumulator[o + 1] / samples / (a / 255 || 1))
    png.data[o + 2] = Math.round(accumulator[o + 2] / samples / (a / 255 || 1))
    png.data[o + 3] = Math.round(a)
  }
  return png
}

/** ICO container with PNG payloads (valid for Windows Vista and later). */
function buildIco(entries) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: icon
  header.writeUInt16LE(entries.length, 4)

  const directorySize = 16 * entries.length
  let offset = 6 + directorySize
  const directory = Buffer.alloc(directorySize)

  entries.forEach((entry, index) => {
    const base = index * 16
    directory[base] = entry.size >= 256 ? 0 : entry.size
    directory[base + 1] = entry.size >= 256 ? 0 : entry.size
    directory[base + 2] = 0 // palette
    directory[base + 3] = 0 // reserved
    directory.writeUInt16LE(1, base + 4) // colour planes
    directory.writeUInt16LE(32, base + 6) // bits per pixel
    directory.writeUInt32LE(entry.png.length, base + 8)
    directory.writeUInt32LE(offset, base + 12)
    offset += entry.png.length
  })

  return Buffer.concat([header, directory, ...entries.map((entry) => entry.png)])
}

function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  const sizes = [16, 24, 32, 64, 256]
  const entries = []
  for (const size of sizes) {
    const png = renderGlyph(size)
    const buffer = PNG.sync.write(png)
    writeFileSync(join(OUT_DIR, `tray-${size}.png`), buffer)
    entries.push({ size, png: buffer })
    console.log(`tray-${size}.png  ${(buffer.length / 1024).toFixed(1)} KB`)
  }

  const ico = buildIco(entries)
  writeFileSync(join(OUT_DIR, 'icon.ico'), ico)
  console.log(`icon.ico          ${(ico.length / 1024).toFixed(1)} KB`)
}

main()
