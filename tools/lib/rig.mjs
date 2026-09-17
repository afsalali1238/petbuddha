/**
 * Rig helpers for the procedural model builder.
 *
 * The Buddha is a rigid-part "vinyl figure" hierarchy rather than a skinned
 * mesh: every limb is its own node carrying its own mesh. That is both the
 * look we want (toy-like, crisp) and the reason the whole thing can be built
 * from code. Clips are baked as node transform tracks, which export to glTF
 * node animations and play back through THREE.AnimationMixer unchanged.
 */
import * as THREE from 'three'

export function eulerToQuat(rx, ry, rz) {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'XYZ'))
}

/** A rig frame: one entry per animated node, defaulting to the bind pose. */
export class Rig {
  constructor(bind) {
    this.bind = bind
    this.frame = {}
    this.reset()
  }

  reset() {
    this.frame = {}
    for (const [node, values] of Object.entries(this.bind)) {
      this.frame[node] = {
        px: values.px ?? 0,
        py: values.py ?? 0,
        pz: values.pz ?? 0,
        rx: values.rx ?? 0,
        ry: values.ry ?? 0,
        rz: values.rz ?? 0,
        sx: values.sx ?? 1,
        sy: values.sy ?? 1,
        sz: values.sz ?? 1
      }
    }
    return this
  }

  /** Merge a partial pose into the current frame. */
  set(pose) {
    for (const [node, values] of Object.entries(pose)) {
      if (!this.frame[node]) this.frame[node] = { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1, sz: 1 }
      Object.assign(this.frame[node], values)
    }
    return this
  }

  snapshot() {
    return JSON.parse(JSON.stringify(this.frame))
  }
}

const VARIANCE_EPS = 1e-6

/**
 * Bake a pose function into an AnimationClip.
 *
 * `fn(t, rig, duration)` mutates a fresh bind pose for each sampled frame; we
 * then diff the frames and emit one track per node property that actually
 * moves, which keeps the exported file small.
 */
export function bakeClip({ name, duration, fps = 30, bind, fn }) {
  const frames = Math.max(2, Math.round(duration * fps) + 1)
  const samples = []

  for (let i = 0; i < frames; i++) {
    const t = (i / (frames - 1)) * duration
    const frame = new Rig(bind)
    fn(t, frame, duration)
    samples.push(frame.snapshot())
  }

  const times = samples.map((_, i) => (i / (frames - 1)) * duration)
  const tracks = []

  for (const node of Object.keys(bind)) {
    const positions = []
    const quaternions = []
    const scales = []
    let movesP = false
    let movesR = false
    let movesS = false
    const first = samples[0][node]

    for (const sample of samples) {
      const f = sample[node]
      positions.push(f.px, f.py, f.pz)
      const q = eulerToQuat(f.rx, f.ry, f.rz)
      quaternions.push(q.x, q.y, q.z, q.w)
      scales.push(f.sx, f.sy, f.sz)

      if (
        Math.abs(f.px - first.px) > VARIANCE_EPS ||
        Math.abs(f.py - first.py) > VARIANCE_EPS ||
        Math.abs(f.pz - first.pz) > VARIANCE_EPS
      ) {
        movesP = true
      }
      if (
        Math.abs(f.rx - first.rx) > VARIANCE_EPS ||
        Math.abs(f.ry - first.ry) > VARIANCE_EPS ||
        Math.abs(f.rz - first.rz) > VARIANCE_EPS
      ) {
        movesR = true
      }
      if (
        Math.abs(f.sx - first.sx) > VARIANCE_EPS ||
        Math.abs(f.sy - first.sy) > VARIANCE_EPS ||
        Math.abs(f.sz - first.sz) > VARIANCE_EPS
      ) {
        movesS = true
      }
    }

    // A pose can hold a *constant* value that differs from the bind pose
    // (sitting still means the hips stay lowered for the whole clip). Those
    // must still be exported, or the property snaps back to bind the moment
    // the action fades out.
    const bindValues = bind[node] ?? {}
    const bindP = [bindValues.px ?? 0, bindValues.py ?? 0, bindValues.pz ?? 0]
    const bindR = [bindValues.rx ?? 0, bindValues.ry ?? 0, bindValues.rz ?? 0]
    const bindS = [bindValues.sx ?? 1, bindValues.sy ?? 1, bindValues.sz ?? 1]
    const firstSample = samples[0][node]
    const offBindP = [0, 1, 2].some((k) => Math.abs(positions[k] - bindP[k]) > VARIANCE_EPS)
    const offBindR = [0, 1, 2].some((k) =>
      Math.abs([firstSample.rx, firstSample.ry, firstSample.rz][k] - bindR[k]) > VARIANCE_EPS
    )
    const offBindS = [0, 1, 2].some((k) => Math.abs(scales[k] - bindS[k]) > VARIANCE_EPS)

    if (movesP || offBindP) {
      tracks.push(new THREE.VectorKeyframeTrack(`${node}.position`, times, positions))
    }
    if (movesR || offBindR) {
      tracks.push(new THREE.QuaternionKeyframeTrack(`${node}.quaternion`, times, quaternions))
    }
    if (movesS || offBindS) {
      tracks.push(new THREE.VectorKeyframeTrack(`${node}.scale`, times, scales))
    }
  }

  return new THREE.AnimationClip(name, duration, tracks)
}

/** Smooth 0..1 ramp, used for cross-fade shaped poses inside a clip. */
export function ramp(t, start, end) {
  if (t <= start) return 0
  if (t >= end) return 1
  const x = (t - start) / (end - start)
  return x * x * (3 - 2 * x)
}

/** One full breath as a -1..1 sine. */
export function breath(t, period, phase = 0) {
  return Math.sin(((t / period) + phase) * Math.PI * 2)
}

/**
 * Piecewise value over time: `seq(t, [[0, a], [0.3, b], [0.8, c]])` smoothsteps
 * between waypoints and holds outside them. This is how every clip pose is
 * authored — one curve per animated property.
 */
export function seq(t, waypoints) {
  if (waypoints.length === 0) return 0
  if (t <= waypoints[0][0]) return waypoints[0][1]
  const last = waypoints[waypoints.length - 1]
  if (t >= last[0]) return last[1]
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [t0, v0] = waypoints[i]
    const [t1, v1] = waypoints[i + 1]
    if (t >= t0 && t <= t1) {
      const x = (t - t0) / (t1 - t0)
      return v0 + (v1 - v0) * (x * x * (3 - 2 * x))
    }
  }
  return last[1]
}

/** Linear interpolation between two numbers. */
export function lerp(a, b, t) {
  return a + (b - a) * t
}
