/**
 * Renders the procedural model to PNG so the M0 silhouette test (§4.7: "the
 * character is readable at 110 px") can be checked by eye or in CI, with no GPU.
 *
 * Usage:
 *   node --experimental-strip-types tools/preview.mjs
 *   node --experimental-strip-types tools/preview.mjs --height 220 --out /tmp/big.png
 */
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { PNG } from 'pngjs'

import { PALETTE, TIME_OF_DAY_RIGS } from '../src/shared/palette.ts'
import { buildBodhi } from './lib/bodhi.mjs'
import { buildTree, SEAT } from './lib/tree.mjs'
import { renderScene, downsample } from './lib/raster.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const argValue = (flag, fallback) => {
  const i = args.indexOf(flag)
  return i >= 0 ? args[i + 1] : fallback
}
const PET_HEIGHT = Number(argValue('--height', 110))
const OUT = argValue('--out', resolve(here, 'preview.png'))
const SS = 3 // supersampling factor

const SUPERSAMPLE = SS

function poseModel(root, clips, clipName, time) {
  const mixer = new THREE.AnimationMixer(root)
  const clip = clips.find((c) => c.name === clipName)
  if (clip) {
    const action = mixer.clipAction(clip)
    action.play()
    // NB: do NOT set action.paused — a paused action has timeScale 0 and would
    // stay on frame 0.
    mixer.setTime(Math.min(time, clip.duration - 1e-4))
  }
  root.updateMatrixWorld(true)
  return mixer
}

function compose(tiles, columns, cellW, cellH) {
  const rows = Math.ceil(tiles.length / columns)
  const png = new PNG({ width: columns * cellW, height: rows * cellH })
  png.data.fill(0)
  tiles.forEach((tile, index) => {
    const cx = (index % columns) * cellW
    const cy = Math.floor(index / columns) * cellH
    for (let y = 0; y < cellH; y++) {
      for (let x = 0; x < cellW; x++) {
        const s = (y * tile.width + x) * 4
        const d = ((cy + y) * png.width + cx + x) * 4
        png.data[d + 0] = tile.data[s + 0]
        png.data[d + 1] = tile.data[s + 1]
        png.data[d + 2] = tile.data[s + 2]
        png.data[d + 3] = tile.data[s + 3]
      }
    }
  })
  return png
}

/** Draw a caption strip under each tile (crude 3x5 bitmap font). */
function caption(png, text, x, y) {
  const font = {
    a: ['010', '101', '111', '101', '101'],
    b: ['110', '101', '110', '101', '110'],
    c: ['011', '100', '100', '100', '011'],
    d: ['110', '101', '101', '101', '110'],
    e: ['111', '100', '110', '100', '111'],
    f: ['111', '100', '110', '100', '100'],
    g: ['011', '100', '101', '101', '011'],
    h: ['101', '101', '111', '101', '101'],
    i: ['111', '010', '010', '010', '111'],
    k: ['101', '101', '110', '101', '101'],
    l: ['100', '100', '100', '100', '111'],
    m: ['101', '111', '111', '101', '101'],
    n: ['110', '101', '101', '101', '101'],
    o: ['010', '101', '101', '101', '010'],
    p: ['110', '101', '110', '100', '100'],
    r: ['110', '101', '110', '101', '101'],
    s: ['011', '100', '010', '001', '110'],
    t: ['111', '010', '010', '010', '010'],
    u: ['101', '101', '101', '101', '011'],
    v: ['101', '101', '101', '101', '010'],
    w: ['101', '101', '111', '111', '101'],
    x: ['101', '101', '010', '101', '101'],
    y: ['101', '101', '010', '010', '010'],
    _: ['000', '000', '000', '000', '001']
  }
  const scale = 2
  let cursor = x
  for (const ch of text.toLowerCase()) {
    const glyph = font[ch] ?? font._
    for (let gy = 0; gy < 5; gy++) {
      for (let gx = 0; gx < 3; gx++) {
        if (glyph[gy][gx] !== '1') continue
        for (let sy = 0; sy < scale; sy++) {
          for (let sx = 0; sx < scale; sx++) {
            const px = cursor + gx * scale + sx
            const py = y + gy * scale + sy
            if (px < 0 || py < 0 || px >= png.width || py >= png.height) continue
            const o = (py * png.width + px) * 4
            png.data[o + 0] = 0
            png.data[o + 1] = 0
            png.data[o + 2] = 0
            png.data[o + 3] = 255
          }
        }
      }
    }
    cursor += 4 * scale
  }
}

function main() {
  const bodhi = buildBodhi({ PALETTE })
  const tree = buildTree({ PALETTE })
  const rig = TIME_OF_DAY_RIGS.day

  const shots = [
    { clip: 'idle_sit', t: 0.0, label: 'idle_sit' },
    { clip: 'meditate', t: 1.25, label: 'meditate' },
    { clip: 'shades_off', t: 0.45, label: 'shades_off' },
    { clip: 'shades_on', t: 0.55, label: 'shades_on' },
    { clip: 'stand_up', t: 0.5, label: 'stand_up_mid' },
    { clip: 'stand_up', t: 0.99, label: 'stand_up' },
    { clip: 'hop_off', t: 0.3, label: 'hop_off' },
    { clip: 'walk', t: 0.18, label: 'walk' },
    { clip: 'walk', t: 0.52, label: 'walk2' },
    { clip: 'sit_down', t: 0.45, label: 'sit_down' },
    { clip: 'nod', t: 0.26, label: 'nod' },
    { clip: 'glance', t: 0.4, label: 'glance' }
  ]

  const cellW = Math.round(PET_HEIGHT * 1.1)
  const cellH = Math.round(PET_HEIGHT * 1.35)
  const tiles = []

  for (const shot of shots) {
    const mixer = poseModel(bodhi.root, bodhi.clips, shot.clip, shot.t)
    const canvas = renderScene({
      root: bodhi.root,
      pxPerUnit: PET_HEIGHT * SUPERSAMPLE,
      width: cellW * SUPERSAMPLE,
      height: cellH * SUPERSAMPLE,
      centre: { x: (cellW * SUPERSAMPLE) / 2, y: cellH * SUPERSAMPLE - 6 * SUPERSAMPLE },
      outlined: (name) => name.startsWith('bodhi_') && !name.includes(':lensVC'),
      outlineWidth: 0.02,
      lightDirection: new THREE.Vector3(-0.45, 0.75, 0.6).normalize(),
      ambientSky: 0.9,
      ambientGround: 0.42
    })
    const tile = downsample(canvas, SUPERSAMPLE)
    tiles.push(tile)
    void mixer
  }

  const sheet = compose(tiles, 4, cellW, cellH)
  shots.forEach((shot, index) => {
    const cx = (index % 4) * cellW + 4
    const cy = Math.floor(index / 4) * cellH + cellH - 14
    caption(sheet, shot.label, cx, cy)
  })
  writeFileSync(OUT, PNG.sync.write(sheet))
  console.log(`wrote ${OUT} (${sheet.width}x${sheet.height})`)

  // The full diorama: tree + seated Buddha, at 2x for judging the composition.
  const scene = new THREE.Group()
  scene.add(tree.root)
  scene.add(bodhi.root)
  poseModel(bodhi.root, bodhi.clips, 'meditate', 1.25)
  bodhi.root.position.set(SEAT.x, SEAT.y, SEAT.z + 0.02)

  const sceneCanvas = renderScene({
    root: scene,
    pxPerUnit: 150 * 2,
    width: 420 * 2,
    height: 320 * 2,
    centre: { x: 210 * 2, y: 300 * 2 },
    outlined: (name) => name.startsWith('bodhi_') && !name.includes(':lensVC'),
    outlineWidth: 0.02,
    lightDirection: new THREE.Vector3(-0.45, 0.75, 0.6).normalize(),
    ambientSky: 0.9,
    ambientGround: 0.42,
    background: [0.96, 0.95, 0.93]
  })
  const scenePng = downsample(sceneCanvas, 2)
  const sceneOut = OUT.replace(/\.png$/, '-scene.png')
  writeFileSync(sceneOut, PNG.sync.write(scenePng))
  console.log(`wrote ${sceneOut} (${scenePng.width}x${scenePng.height})`)

  void rig
  void PALETTE
}

main()
