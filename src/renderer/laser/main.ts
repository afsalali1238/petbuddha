import { PALETTE } from '@shared/palette'
import type { BlastPayload } from '@shared/types'

/**
 * The laser overlay (§6.6): a 2D canvas, not WebGL — a couple of beams and
 * scorch marks do not need a 3D context, and a second WebGL context would cost
 * more than the whole effect.
 *
 * Safety: at most three flashes per second, and nothing here ever intercepts
 * input or moves an OS window.
 */
const canvas = document.getElementById('laser') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!

interface Scorch {
  x1: number
  y1: number
  x2: number
  y2: number
  born: number
}

let blast: BlastPayload | null = null
let startedAt = 0
let scorches: Scorch[] = []
let raf = 0
let dpr = 1

const TIER_MS: Record<number, number> = { 1: 1500, 2: 3000, 3: 3000 }

function resize(): void {
  dpr = Math.min(window.devicePixelRatio, 2)
  canvas.width = Math.floor(window.innerWidth * dpr)
  canvas.height = Math.floor(window.innerHeight * dpr)
}

window.addEventListener('resize', resize)
resize()

function clear(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
}

/** Reduce motion: a static red edge outline instead of any beam (§6.5). */
function drawEdgeOutline(): void {
  const w = canvas.width
  const h = canvas.height
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.strokeStyle = PALETTE.laserCore
  ctx.lineWidth = 6 * dpr
  ctx.globalAlpha = 0.85
  ctx.strokeRect(3 * dpr, 3 * dpr, w - 6 * dpr, h - 6 * dpr)
  ctx.restore()
}

function drawBeam(
  from: { x: number; y: number },
  to: { x: number; y: number },
  width: number,
  alpha: number
): void {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'

  // glow
  ctx.strokeStyle = PALETTE.laserGlow
  ctx.globalAlpha = alpha * 0.55
  ctx.lineWidth = width * 4 * dpr
  ctx.beginPath()
  ctx.moveTo(from.x * dpr, from.y * dpr)
  ctx.lineTo(to.x * dpr, to.y * dpr)
  ctx.stroke()

  // core
  ctx.strokeStyle = PALETTE.laserCore
  ctx.globalAlpha = alpha
  ctx.lineWidth = width * dpr
  ctx.beginPath()
  ctx.moveTo(from.x * dpr, from.y * dpr)
  ctx.lineTo(to.x * dpr, to.y * dpr)
  ctx.stroke()
  ctx.restore()
}

function drawScorches(now: number): void {
  ctx.save()
  ctx.globalCompositeOperation = 'source-over'
  ctx.lineCap = 'round'
  for (const scorch of scorches) {
    const age = now - scorch.born
    if (age > 800) continue
    const alpha = (1 - age / 800) * 0.5
    ctx.strokeStyle = '#3A2320'
    ctx.globalAlpha = alpha
    ctx.lineWidth = 2 * dpr
    ctx.beginPath()
    ctx.moveTo(scorch.x1 * dpr, scorch.y1 * dpr)
    ctx.lineTo(scorch.x2 * dpr, scorch.y2 * dpr)
    ctx.stroke()
  }
  ctx.restore()
  scorches = scorches.filter((scorch) => now - scorch.born <= 800)
}

function targetAt(progress: number): { x: number; y: number } {
  if (!blast) return { x: 0, y: 0 }
  const { target, tier } = blast
  if (tier === 1) return target
  // Sweep: the beam rakes across the target area (§6.5 tier 2/3).
  const sweep = Math.sin(progress * Math.PI * 4) * (window.innerWidth * 0.22)
  return { x: target.x + sweep, y: target.y + Math.cos(progress * Math.PI * 3) * 12 }
}

function frame(now: number): void {
  if (!blast) return
  const elapsed = now - startedAt
  const duration = TIER_MS[blast.tier] ?? 1500
  const progress = Math.max(0, Math.min(1, elapsed / duration))

  clear()

  if (blast.reduceMotion) {
    drawEdgeOutline()
    if (elapsed < duration) raf = requestAnimationFrame(frame)
    else stop()
    return
  }

  // Two frames of lens flash, then the beam (§6.5 tier 1).
  const flash = elapsed < 120 ? 1 : 0.9 + Math.sin(elapsed / 40) * 0.1
  const fade = progress > 0.85 ? 1 - (progress - 0.85) / 0.15 : 1
  const alpha = Math.max(0, Math.min(1, flash * fade))

  const aim = targetAt(progress)

  drawBeam(blast.lensL, aim, 3, alpha)
  drawBeam(blast.lensR, aim, 3, alpha)

  if (Math.random() < 0.35) {
    scorches.push({
      x1: blast.lensL.x,
      y1: blast.lensL.y,
      x2: aim.x,
      y2: aim.y,
      born: now
    })
  }
  drawScorches(now)

  if (elapsed < duration) raf = requestAnimationFrame(frame)
  else stop()
}

function stop(): void {
  cancelAnimationFrame(raf)
  raf = 0
  blast = null
  scorches = []
  clear()
}

window.api.onBlastFire((payload) => {
  resize()
  blast = payload
  startedAt = performance.now()
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(frame)
})

window.api.onBlastStop(() => {
  // Switching back must kill the beam well inside 300 ms (§6.5).
  stop()
})

window.api.ready?.()
