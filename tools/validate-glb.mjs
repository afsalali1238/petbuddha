/**
 * glTF validation (§4.8): "Every export must pass gltf-validator with zero
 * errors." Run this after tools/build-model.mjs, and in CI.
 *
 *   node tools/validate-glb.mjs
 */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import validator from 'gltf-validator'

const here = dirname(fileURLToPath(import.meta.url))
const MODEL_DIR = resolve(here, '../assets/models')

async function validate(name) {
  const file = join(MODEL_DIR, name)
  const data = new Uint8Array(readFileSync(file))
  const report = await validator.validateBytes(data, {
    maxIssues: 20,
    ignoredIssues: [],
    severityOverrides: {}
  })

  const errors = report.issues.messages.filter((m) => m.severity === 0)
  const warnings = report.issues.messages.filter((m) => m.severity === 1)
  const infos = report.issues.messages.filter((m) => m.severity === 2)
  const hints = report.issues.messages.filter((m) => m.severity === 3)

  console.log(`\n=== ${name} ===`)
  console.log(`  validator ${report.validatorVersion} · mimeType ${report.mimeType}`)
  console.log(
    `  ${report.info.animationCount} animations · ${report.info.materialCount} materials · ` +
      `${report.info.meshCount} meshes · ${report.info.nodeCount} nodes · ` +
      `${report.info.totalTriangleCount} triangles · ${report.info.totalVertexCount} vertices`
  )
  console.log(`  errors ${errors.length}, warnings ${warnings.length}, infos ${infos.length}, hints ${hints.length}`)

  for (const message of errors) {
    console.error(`  ERROR [${message.code}] ${message.pointer}: ${message.message}`)
  }
  for (const message of warnings.slice(0, 8)) {
    console.warn(`  warn  [${message.code}] ${message.pointer}: ${message.message}`)
  }

  return errors.length
}

async function main() {
  let errors = 0
  for (const file of ['bodhi.glb', 'tree.glb']) {
    errors += await validate(file)
  }
  if (errors > 0) {
    console.error(`\nFAILED: ${errors} glTF error(s)`)
    process.exitCode = 1
    return
  }
  console.log('\nOK: both models pass gltf-validator with zero errors')
}

await main()
