/**
 * ASCII preview — the M0 silhouette test (§4.7) in a form a terminal (or an
 * agent without a display) can read.
 *
 *   node --experimental-strip-types tools/preview-ascii.mjs [clip] [time]
 *
 * Each character is one pixel of the 110 px-tall render, sampled every other
 * row so the aspect ratio survives a terminal's tall cells.
 */
import * as THREE from 'three'

import { PALETTE } from '../src/shared/palette.ts'
import { buildBodhi } from './lib/bodhi.mjs'
import { buildTree, SEAT } from './lib/tree.mjs'
import { renderScene } from './lib/raster.mjs'

const CHAR_BY_ROLE = {
  outline: '#',
  shadesFrame: '#',
  lensIdle: '@',
  lensHighlight: '*',
  skinBase: '.',
  skinShade: ',',
  robeBase: 'o',
  robeShade: '0',
  sash: 's',
  islandGrass: 'v',
  islandDirt: 'd',
  trunk: 't',
  leafLight: 'v',
  leafDark: 'V',
  cushion: 'c',
  cushionBand: 'C'
}

/**
 * Reference colours are the raw sRGB hex values (no colour management), and
 * pixels are converted back out of the renderer's linear working space before
 * comparison — otherwise near-whites and near-reds collapse together.
 */
const ROLE_COLORS = Object.entries(CHAR_BY_ROLE).map(([role, char]) => {
  const color = new THREE.Color()
  color.setStyle(PALETTE[role] ?? '#888888', THREE.LinearSRGBColorSpace)
  return { role, char, color }
})

const scratch = new THREE.Color()

function classify(r, g, b) {
  scratch.setRGB(r, g, b).convertLinearToSRGB()
  let best = null
  let bestDistance = Infinity
  for (const entry of ROLE_COLORS) {
    const d =
      (scratch.r - entry.color.r) ** 2 +
      (scratch.g - entry.color.g) ** 2 +
      (scratch.b - entry.color.b) ** 2
    if (d < bestDistance) {
      bestDistance = d
      best = entry
    }
  }
  return best.char
}

function pose(root, clips, clipName, time) {
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
}

/**
 * Sample the render into text. Character cells are twice as tall as they are
 * wide, so we step twice as far in y as in x (sy = 2 * sx) to keep the
 * silhouette's proportions honest.
 */
function ascii(render, sx = 2) {
  const sy = sx * 2
  const cols = Math.ceil(render.width / sx)
  const rows = Math.ceil(render.height / sy)
  const lines = []
  for (let r = 0; r < rows; r++) {
    let line = ''
    for (let c = 0; c < cols; c++) {
      const x = Math.min(render.width - 1, c * sx)
      const y = Math.min(render.height - 1, r * sy)
      const i = y * render.width + x
      if (render.alpha[i] < 0.5) {
        line += ' '
        continue
      }
      line += classify(render.pixels[i * 3], render.pixels[i * 3 + 1], render.pixels[i * 3 + 2])
    }
    lines.push(line.replace(/\s+$/, ''))
  }
  return lines.join('\n')
}

function stats(render) {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let covered = 0
  for (let y = 0; y < render.height; y++) {
    for (let x = 0; x < render.width; x++) {
      if (render.alpha[y * render.width + x] < 0.5) continue
      covered++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return {
    covered,
    width: maxX - minX + 1,
    height: maxY - minY + 1
  }
}

/** Render the whole diorama: island, cushion, tree, and the seated Buddha. */
function renderDiorama(clipName, time) {
  const bodhi = buildBodhi({ PALETTE })
  const tree = buildTree({ PALETTE })
  pose(bodhi.root, bodhi.clips, clipName, time)
  bodhi.root.position.set(SEAT.x, SEAT.y, SEAT.z + 0.02)

  const scene = new THREE.Group()
  scene.add(tree.root)
  scene.add(bodhi.root)

  const render = renderScene({
    root: scene,
    pxPerUnit: 90,
    width: 200,
    height: 190,
    centre: { x: 100, y: 180 },
    outlined: (name) => name.startsWith('bodhi_') && !name.includes(':lensVC'),
    outlineWidth: 0.02,
    flat: true
  })
  console.log(`--- diorama: ${clipName} @ ${time}s ---`)
  console.log(ascii(render, 2))
}

function main() {
  if (process.argv[2] === '--scene') {
    renderDiorama(process.argv[3] ?? 'meditate', Number(process.argv[4] ?? 1.25))
    return
  }
  const clipName = process.argv[2] ?? 'idle_sit'
  const time = Number(process.argv[3] ?? 0)
  const height = Number(process.argv[4] ?? 110)

  const bodhi = buildBodhi({ PALETTE })
  pose(bodhi.root, bodhi.clips, clipName, time)

  const scale = 1
  const render = renderScene({
    root: bodhi.root,
    pxPerUnit: height * scale,
    width: Math.round(height * 1.1 * scale),
    height: Math.round(height * 1.15 * scale),
    centre: { x: Math.round((height * 1.1 * scale) / 2), y: Math.round(height * 1.12 * scale) },
    outlined: (name) => name.startsWith('bodhi_') && !name.includes(':lensVC'),
    outlineWidth: 0.02,
    flat: true
  })

  const info = stats(render)
  console.log(`--- ${clipName} @ ${time}s (${height} px tall) ---`)
  console.log(ascii(render, 2))
  console.log(
    `silhouette ${info.width}x${info.height} px, ${info.covered} px covered ` +
      `(readable at 110 px: ${info.width >= 24 && info.height >= 90 ? 'yes' : 'CHECK'})`
  )
  void buildTree
}

main()
