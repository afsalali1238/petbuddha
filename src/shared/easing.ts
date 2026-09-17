/** Easing used by the walk and by every "pop" scale-in (§4.5, §7.5). */

export function easeInOutQuad(t: number): number {
  const x = clamp01(t)
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

export function easeOutQuad(t: number): number {
  const x = clamp01(t)
  return 1 - (1 - x) * (1 - x)
}

/** Back-out, used for the 0.35 s foliage "pop" (§4.5). */
export function easeOutBack(t: number, overshoot = 1.70158): number {
  const x = clamp01(t)
  const c3 = overshoot + 1
  return 1 + c3 * Math.pow(x - 1, 3) + overshoot * Math.pow(x - 1, 2)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp01(t)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0
  return Math.min(1, Math.max(0, t))
}
