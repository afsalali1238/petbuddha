/**
 * M0 asset pipeline (§4.7 route 3 + §4.8): build the chibi Buddha and the Bodhi
 * tree procedurally, bake every contract clip, and export glTF 2.0 binaries.
 *
 * Run with:  node --experimental-strip-types tools/build-model.mjs
 *
 * Hard gates enforced here (§4.1, §4.8):
 *   bodhi tris <= 6000, tree tris <= 4500, bodhi.glb <= 600 KB, tree.glb <= 500 KB,
 *   every contract clip present with the exact name and duration.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'

import { PALETTE } from '../src/shared/palette.ts'
import { CLIPS } from '../src/shared/constants.ts'
import { buildBodhi } from './lib/bodhi.mjs'
import { buildTree } from './lib/tree.mjs'

/**
 * GLTFExporter assembles its binary chunk through FileReader, which Node does
 * not provide. A two-line polyfill is enough for a texture-free export.
 */
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    constructor() {
      this.result = null
      this.onloadend = null
    }
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = buffer
        this.onloadend?.()
      })
    }
    readAsDataURL(blob) {
      blob.arrayBuffer().then((buffer) => {
        this.result = `data:application/octet-stream;base64,${Buffer.from(buffer).toString('base64')}`
        this.onloadend?.()
      })
    }
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(here, '../assets/models')

const BUDGETS = {
  bodhi: { tris: 6000, bytes: 600 * 1024 },
  tree: { tris: 4500, bytes: 500 * 1024 }
}

export function exportGlb(root, animations = []) {
  const exporter = new GLTFExporter()
  return new Promise((ok, fail) => {
    exporter.parse(
      root,
      (result) => ok(result),
      (error) => fail(error),
      {
        binary: true,
        animations,
        onlyVisible: true,
        truncateDrawRange: false,
        includeCustomExtensions: false
      }
    )
  })
}

function countTris(root) {
  let tris = 0
  let meshes = 0
  root.traverse((object) => {
    if (!object.isMesh) return
    meshes++
    const geometry = object.geometry
    tris += geometry.index
      ? geometry.index.count / 3
      : geometry.getAttribute('position').count / 3
  })
  return { tris: Math.round(tris), meshes }
}

function materialCount(root) {
  const set = new Set()
  root.traverse((object) => {
    if (object.isMesh) set.add(object.material.uuid)
  })
  return set.size
}

function validateClips(clips, expected) {
  const problems = []
  const byName = new Map(clips.map((c) => [c.name, c]))
  for (const spec of Object.values(expected)) {
    const clip = byName.get(spec.name)
    if (!clip) {
      problems.push(`missing clip "${spec.name}"`)
      continue
    }
    if (Math.abs(clip.duration - spec.duration) > 1e-6) {
      problems.push(`clip "${spec.name}" is ${clip.duration}s, contract says ${spec.duration}s`)
    }
    if (clip.tracks.length === 0) {
      problems.push(`clip "${spec.name}" has no tracks`)
    }
  }
  return { problems, byName }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  const bodhi = buildBodhi({ PALETTE })
  const tree = buildTree({ PALETTE })

  const bodhiStats = countTris(bodhi.root)
  const treeStats = countTris(tree.root)

  const bodhiBuffer = await exportGlb(bodhi.root, bodhi.clips)
  const treeBuffer = await exportGlb(tree.root, [])

  const bodhiBytes = Buffer.from(bodhiBuffer)
  const treeBytes = Buffer.from(treeBuffer)

  writeFileSync(join(OUT_DIR, 'bodhi.glb'), bodhiBytes)
  writeFileSync(join(OUT_DIR, 'tree.glb'), treeBytes)

  const { problems, byName } = validateClips(bodhi.clips, CLIPS)

  const report = {
    bodhi: {
      triangles: bodhiStats.tris,
      meshes: bodhiStats.meshes,
      materials: materialCount(bodhi.root),
      bytes: bodhiBytes.length
    },
    tree: {
      triangles: treeStats.tris,
      meshes: treeStats.meshes,
      materials: materialCount(tree.root),
      bytes: treeBytes.length
    },
    clips: bodhi.clips.map((c) => ({
      name: c.name,
      duration: Number(c.duration.toFixed(3)),
      tracks: c.tracks.length
    })),
    problems
  }

  console.log(JSON.stringify(report, null, 2))

  console.log('\n--- contract clips (§4.3) ---')
  for (const spec of Object.values(CLIPS)) {
    const clip = byName.get(spec.name)
    const status = clip ? `ok  ${clip.duration.toFixed(2)}s  ${clip.tracks} tracks` : 'MISSING'
    console.log(`  ${spec.name.padEnd(16)} ${spec.duration.toFixed(1)}s  ${status}`)
  }
  for (const extra of bodhi.clips.filter((c) => !Object.values(CLIPS).some((s) => s.name === c.name))) {
    console.log(`  ${extra.name.padEnd(16)} (companion, ${extra.duration.toFixed(1)}s)`)
  }

  // --- hard gates ----------------------------------------------------------
  const failures = [...problems]
  if (bodhiStats.tris > BUDGETS.bodhi.tris) {
    failures.push(`bodhi has ${bodhiStats.tris} tris, budget is ${BUDGETS.bodhi.tris}`)
  }
  if (treeStats.tris > BUDGETS.tree.tris) {
    failures.push(`tree has ${treeStats.tris} tris, budget is ${BUDGETS.tree.tris}`)
  }
  if (bodhiBytes.length > BUDGETS.bodhi.bytes) {
    failures.push(`bodhi.glb is ${(bodhiBytes.length / 1024).toFixed(0)} KB, budget is 600 KB`)
  }
  if (treeBytes.length > BUDGETS.tree.bytes) {
    failures.push(`tree.glb is ${(treeBytes.length / 1024).toFixed(0)} KB, budget is 500 KB`)
  }

  if (failures.length > 0) {
    console.error('\nFAILED:')
    for (const f of failures) console.error(`  - ${f}`)
    process.exitCode = 1
    return
  }

  console.log(
    `\nOK: bodhi ${bodhiStats.tris} tris / ${(bodhiBytes.length / 1024).toFixed(0)} KB, ` +
      `tree ${treeStats.tris} tris / ${(treeBytes.length / 1024).toFixed(0)} KB, ` +
      `scene ${bodhiStats.tris + treeStats.tris} tris / ${bodhiStats.meshes + treeStats.meshes} meshes`
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})

void THREE
