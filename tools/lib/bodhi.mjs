/**
 * The chibi Buddha (§3) — built from primitives, no textures, no UVs.
 *
 * Proportions (§3.2), chibi ~2.2 heads tall, total height normalised to 1.0:
 *   head 45% of height, pear body widest at the seated hips, no visible neck,
 *   short chubby arms with mitten hands, stubby legs with rounded feet.
 *
 * The character faces +Z. His left is +X, his right is -X (so the robe drapes
 * over the +X shoulder and the bare shoulder is -X, per §3.4).
 */
import * as THREE from 'three'
import * as G from './geometry.mjs'
import { bakeClip, breath, seq, lerp } from './rig.mjs'

/** Heights in model units. y = 0 is the floor; the cushion top is CUSHION_TOP. */
export const CUSHION_TOP = 0.12
const STAND_HIPS_Y = 0.15
const SEAT_HIPS_Y = 0.06
/** how far in front of the diorama he walks (depth only; ortho has no parallax) */
const WALK_PZ = 0.10

/**
 * Bind pose: standing on the floor, arms relaxed at his sides.
 * Every clip is authored as an absolute offset from these values.
 */
export const BIND = {
  root: { py: 0, pz: 0 },
  hips: { py: STAND_HIPS_Y, px: 0 },
  spine: { py: 0.10, rx: 0, rz: 0 },
  chest: { py: 0.16, rx: 0, rz: 0, sy: 1, sx: 1 },
  neck: { py: 0.14, rx: 0 },
  head: { py: 0.225, rx: 0, ry: 0, rz: 0 },
  topknot: { py: 0.20, pz: -0.05 },
  shoulder_l: { px: 0.19, py: 0.09 },
  shoulder_r: { px: -0.19, py: 0.09 },
  arm_l: { rz: -0.12, rx: 0 },
  arm_r: { rz: 0.12, rx: 0 },
  hand_l: { py: -0.17, rx: 0 },
  hand_r: { py: -0.17, rx: 0 },
  thigh_l: { px: 0.10, py: -0.02, rx: 0, rz: 0 },
  thigh_r: { px: -0.10, py: -0.02, rx: 0, rz: 0 },
  foot_l: { py: -0.10, rx: 0 },
  foot_r: { py: -0.10, rx: 0 },
  shades_worn: { sx: 1, sy: 1, sz: 1 },
  shades_sash: { sx: 0, sy: 0, sz: 0 }
}

/** Seated on the cushion: legs folded under the robe, spine tall but soft. */
const POSE_SIT = {
  root: { py: CUSHION_TOP, pz: 0 },
  hips: { py: SEAT_HIPS_Y, px: 0 },
  spine: { rx: 0.05, rz: 0 },
  chest: { rx: 0.02, rz: 0, sy: 1, sx: 1 },
  neck: { rx: -0.02 },
  head: { rx: 0.06, ry: 0, rz: 0, py: 0.225 },
  thigh_l: { rx: -1.25, rz: 0.45 },
  thigh_r: { rx: -1.25, rz: -0.45 },
  foot_l: { rx: 1.15, rz: -0.15 },
  foot_r: { rx: 1.15, rz: 0.15 },
  arm_l: { rx: -0.55, rz: -0.30 },
  arm_r: { rx: -0.55, rz: 0.30 },
  hand_l: { rx: 0.35 },
  hand_r: { rx: 0.35 }
}

/** Idle / Ready: right hand raised at chest height, left hand palm-up in lap. */
const POSE_IDLE = {
  ...POSE_SIT,
  arm_l: { rx: -0.50, rz: -0.34 },
  arm_r: { rx: -1.90, rz: 0.50 },
  hand_l: { rx: 0.42 },
  hand_r: { rx: -0.45 }
}

/** Standing on the cushion (end of stand_up, start of hop_off). */
const POSE_STAND_CUSHION = {
  root: { py: CUSHION_TOP, pz: 0 },
  hips: { py: STAND_HIPS_Y, px: 0 },
  spine: { rx: 0, rz: 0 },
  chest: { rx: 0, rz: 0, sy: 1, sx: 1 },
  neck: { rx: 0 },
  head: { rx: 0, ry: 0, rz: 0, py: 0.225 },
  thigh_l: { rx: 0, rz: 0 },
  thigh_r: { rx: 0, rz: 0 },
  foot_l: { rx: 0, rz: 0 },
  foot_r: { rx: 0, rz: 0 },
  arm_l: { rx: 0, rz: -0.12 },
  arm_r: { rx: 0, rz: 0.12 },
  hand_l: { rx: 0 },
  hand_r: { rx: 0 }
}

/** Standing on the floor (walking). */
const POSE_STAND_FLOOR = {
  ...POSE_STAND_CUSHION,
  root: { py: 0, pz: WALK_PZ }
}

/**
 * Shades must be asserted by *every* clip: a one-shot clip's pose is lost the
 * moment its action fades out, which would make the shades pop back onto his
 * face during Focus.
 */
function shades(rig, worn) {
  if (worn) {
    rig.set({ shades_worn: { sx: 1, sy: 1, sz: 1 }, shades_sash: { sx: 0, sy: 0, sz: 0 } })
  } else {
    rig.set({ shades_worn: { sx: 0, sy: 0, sz: 0 }, shades_sash: { sx: 1, sy: 1, sz: 1 } })
  }
  return rig
}

/** Breathing overlay: chest, shoulders, head bob. Subtle, ~5 s cycle (§3.5). */
function breathing(rig, t, period, amount = 1) {
  const b = breath(t, period)
  rig.set({
    chest: { sy: 1 + 0.03 * b * amount, sx: 1 + 0.02 * b * amount },
    spine: { rx: (rig.frame.spine.rx ?? 0) + 0.012 * b * amount },
    shoulder_l: { py: 0.09 + 0.005 * b * amount },
    shoulder_r: { py: 0.09 + 0.005 * b * amount },
    head: { py: 0.225 + 0.006 * b * amount, rx: (rig.frame.head.rx ?? 0) - 0.012 * b * amount }
  })
  return rig
}

/* ------------------------------------------------------------------------ */
/* Clips (§4.3). Names and durations are a hard contract.                    */
/* ------------------------------------------------------------------------ */

function idleSit(t, rig) {
  rig.set(POSE_IDLE)
  breathing(rig, t, 4.0) // loops perfectly over the 4 s clip
  // occasional slow head tilt
  rig.set({ head: { rz: 0.055 * breath(t, 4.0, 0.25), ry: 0.03 * breath(t, 8.0, 0.1) } })
  shades(rig, true)
}

function meditate(t, rig) {
  rig.set(POSE_SIT)
  breathing(rig, t, 5.0) // one full breath per 5 s clip (§4.3)
  // the faintest sway, so meditation never looks frozen
  rig.set({ spine: { rz: 0.012 * breath(t, 10.0) }, head: { ry: 0.02 * breath(t, 10.0, 0.3) } })
  shades(rig, false)
}

/**
 * Hero beat (§3.4): he reaches up, takes the shades off and hangs them on his
 * sash, then settles into the meditation pose.
 */
function shadesOff(t, rig) {
  const toFace = seq(t, [
    [0, 0],
    [0.3, 1]
  ])
  const toSash = seq(t, [
    [0.3, 0],
    [0.58, 1]
  ])
  const settle = seq(t, [
    [0.58, 0],
    [0.8, 1]
  ])

  rig.set(POSE_IDLE)
  // right hand rises to the lenses
  rig.set({
    arm_r: { rx: lerp(-1.9, -2.28, toFace), rz: lerp(0.5, 0.26, toFace) },
    hand_r: { rx: lerp(-0.45, -0.62, toFace) },
    head: { rx: lerp(0.06, -0.03, toFace), ry: lerp(0, -0.05, toFace) },
    spine: { rx: lerp(0.05, 0.02, toFace) }
  })
  // the swap is hidden behind the mitten hand
  shades(rig, t < 0.3)
  // hand travels down to the sash and hooks them on
  rig.set({
    arm_r: {
      rx: t < 0.3 ? rig.frame.arm_r.rx : lerp(-2.28, -0.95, toSash),
      rz: t < 0.3 ? rig.frame.arm_r.rz : lerp(0.26, 0.72, toSash)
    },
    hand_r: { rx: t < 0.3 ? rig.frame.hand_r.rx : lerp(-0.62, 0.55, toSash) },
    head: { rx: t < 0.3 ? rig.frame.head.rx : lerp(-0.03, 0.06, toSash) }
  })
  // settle into the meditation pose
  rig.set({
    arm_r: {
      rx: t < 0.58 ? rig.frame.arm_r.rx : lerp(-0.95, -0.55, settle),
      rz: t < 0.58 ? rig.frame.arm_r.rz : lerp(0.72, 0.3, settle)
    },
    hand_r: { rx: t < 0.58 ? rig.frame.hand_r.rx : lerp(0.55, 0.35, settle) },
    arm_l: { rx: lerp(-0.5, -0.55, settle), rz: lerp(-0.34, -0.3, settle) },
    hand_l: { rx: lerp(0.42, 0.35, settle) }
  })
}

/** Shades back on with a small flick (§3.4). */
function shadesOn(t, rig) {
  const toSash = seq(t, [
    [0, 0],
    [0.18, 1]
  ])
  const toFace = seq(t, [
    [0.18, 0],
    [0.46, 1]
  ])
  const flick = seq(t, [
    [0.46, 0],
    [0.56, 1],
    [0.6, 0]
  ])

  rig.set(POSE_SIT)
  rig.set({
    arm_r: { rx: lerp(-0.55, -0.95, toSash), rz: lerp(0.3, 0.72, toSash) },
    hand_r: { rx: lerp(0.35, 0.55, toSash) }
  })
  shades(rig, t < 0.18)
  rig.set({
    arm_r: {
      rx: t < 0.18 ? rig.frame.arm_r.rx : lerp(-0.95, -2.25, toFace),
      rz: t < 0.18 ? rig.frame.arm_r.rz : lerp(0.72, 0.28, toFace)
    },
    hand_r: { rx: t < 0.18 ? rig.frame.hand_r.rx : lerp(0.55, -0.6, toFace) }
  })
  // settle into the idle pose, with the lens flick on the way
  rig.set({
    arm_r: {
      rx: t < 0.46 ? rig.frame.arm_r.rx : lerp(-2.25, -1.9, seq(t, [[0.46, 0], [0.6, 1]])),
      rz: t < 0.46 ? rig.frame.arm_r.rz : lerp(0.28, 0.5, seq(t, [[0.46, 0], [0.6, 1]]))
    },
    hand_r: { rx: t < 0.46 ? rig.frame.hand_r.rx : lerp(-0.6, -0.45, seq(t, [[0.46, 0], [0.6, 1]])) },
    head: { rx: 0.06 - 0.10 * flick },
    shades_worn: { sx: 1 + 0.06 * flick, sy: 1 + 0.06 * flick, sz: 1 + 0.06 * flick }
  })
}

/**
 * The stand-up trick (§4.4): the legs are simply there when the leaf puff
 * clears at the halfway mark. Anticipation first, squash-and-stretch after.
 */
function standUp(t, rig) {
  const rise = seq(t, [
    [0.25, 0],
    [0.62, 1]
  ])
  const settle = seq(t, [
    [0.62, 0],
    [1.0, 1]
  ])

  rig.set(POSE_SIT)
  // anticipation: he sinks 10% and leans forward before rising (§3.5)
  rig.set({
    hips: { py: lerp(SEAT_HIPS_Y, SEAT_HIPS_Y - 0.012, seq(t, [[0, 0], [0.25, 1]])) },
    spine: { rx: lerp(0.05, 0.16, seq(t, [[0, 0], [0.25, 1]])) },
    head: { rx: lerp(0.06, 0.16, seq(t, [[0, 0], [0.25, 1]])) },
    arm_l: { rx: lerp(-0.55, -0.75, seq(t, [[0, 0], [0.25, 1]])), rz: lerp(-0.3, -0.42, seq(t, [[0, 0], [0.25, 1]])) },
    arm_r: { rx: lerp(-0.55, -0.75, seq(t, [[0, 0], [0.25, 1]])), rz: lerp(0.3, 0.42, seq(t, [[0, 0], [0.25, 1]])) }
  })
  // rise: legs unfold while the robe hem still hides them; puff at 0.5 s
  rig.set({
    hips: { py: t < 0.25 ? rig.frame.hips.py : lerp(SEAT_HIPS_Y - 0.012, STAND_HIPS_Y + 0.008, rise) },
    spine: { rx: t < 0.25 ? rig.frame.spine.rx : lerp(0.16, -0.06, rise) },
    head: { rx: t < 0.25 ? rig.frame.head.rx : lerp(0.16, -0.03, rise) },
    thigh_l: { rx: lerp(-1.25, 0, rise), rz: lerp(0.45, 0, rise) },
    thigh_r: { rx: lerp(-1.25, 0, rise), rz: lerp(-0.45, 0, rise) },
    foot_l: { rx: lerp(1.15, 0, rise), rz: lerp(-0.15, 0, rise) },
    foot_r: { rx: lerp(1.15, 0, rise), rz: lerp(0.15, 0, rise) },
    arm_l: { rx: t < 0.25 ? rig.frame.arm_l.rx : lerp(-0.75, -0.35, rise) },
    arm_r: { rx: t < 0.25 ? rig.frame.arm_r.rx : lerp(-0.75, -0.35, rise) }
  })
  // squash and stretch, then settle (§3.1)
  const stretch = Math.sin(settle * Math.PI)
  rig.set({
    hips: { py: t < 0.62 ? rig.frame.hips.py : lerp(STAND_HIPS_Y + 0.008, STAND_HIPS_Y, settle) },
    chest: { sy: 1 + 0.07 * stretch, sx: 1 - 0.04 * stretch },
    spine: { rx: t < 0.62 ? rig.frame.spine.rx : lerp(-0.06, 0, settle) },
    arm_l: { rx: t < 0.62 ? rig.frame.arm_l.rx : lerp(-0.35, 0, settle), rz: t < 0.62 ? rig.frame.arm_l.rz : lerp(-0.42, -0.12, settle) },
    arm_r: { rx: t < 0.62 ? rig.frame.arm_r.rx : lerp(-0.35, 0, settle), rz: t < 0.62 ? rig.frame.arm_r.rz : lerp(0.42, 0.12, settle) },
    head: { rx: t < 0.62 ? rig.frame.head.rx : lerp(-0.03, 0, settle) }
  })
  shades(rig, true)
}

/** Hop down from the cushion onto the desktop floor. */
function hopOff(t, rig) {
  const air = seq(t, [
    [0, 0],
    [0.6, 1]
  ])
  rig.set(POSE_STAND_CUSHION)
  rig.set({
    root: {
      py: lerp(CUSHION_TOP, 0, air) + 0.05 * Math.sin(air * Math.PI),
      pz: lerp(0, WALK_PZ, air)
    },
    hips: { py: STAND_HIPS_Y - 0.012 * Math.sin(air * Math.PI) },
    chest: { sy: 1 - 0.06 * Math.sin(air * Math.PI), sx: 1 + 0.04 * Math.sin(air * Math.PI) },
    spine: { rx: -0.20 * Math.sin(air * Math.PI) },
    arm_l: { rx: -0.55 * Math.sin(air * Math.PI), rz: -0.12 - 0.25 * Math.sin(air * Math.PI) },
    arm_r: { rx: -0.55 * Math.sin(air * Math.PI), rz: 0.12 + 0.25 * Math.sin(air * Math.PI) },
    thigh_l: { rx: -0.35 * Math.sin(air * Math.PI) },
    thigh_r: { rx: -0.35 * Math.sin(air * Math.PI) },
    foot_l: { rx: 0.30 * Math.sin(air * Math.PI) },
    foot_r: { rx: 0.30 * Math.sin(air * Math.PI) }
  })
  // landing squash
  const land = seq(t, [
    [0.5, 0],
    [0.6, 1],
    [0.6, 1]
  ])
  rig.set({
    chest: { sy: rig.frame.chest.sy - 0.10 * land * (1 - land) * 4, sx: rig.frame.chest.sx + 0.07 * land * (1 - land) * 4 }
  })
  shades(rig, true)
}

/** Hop back up onto the cushion. */
function hopOn(t, rig) {
  const air = seq(t, [
    [0, 0],
    [0.6, 1]
  ])
  rig.set(POSE_STAND_FLOOR)
  rig.set({
    root: {
      py: lerp(0, CUSHION_TOP, air) + 0.06 * Math.sin(air * Math.PI),
      pz: lerp(WALK_PZ, 0, air)
    },
    hips: { py: STAND_HIPS_Y - 0.014 * Math.sin(air * Math.PI) },
    chest: { sy: 1 - 0.07 * Math.sin(air * Math.PI), sx: 1 + 0.04 * Math.sin(air * Math.PI) },
    spine: { rx: 0.22 * Math.sin(air * Math.PI) },
    arm_l: { rx: -0.75 * Math.sin(air * Math.PI), rz: -0.12 - 0.30 * Math.sin(air * Math.PI) },
    arm_r: { rx: -0.75 * Math.sin(air * Math.PI), rz: 0.12 + 0.30 * Math.sin(air * Math.PI) },
    thigh_l: { rx: -0.45 * Math.sin(air * Math.PI) },
    thigh_r: { rx: -0.45 * Math.sin(air * Math.PI) },
    foot_l: { rx: 0.35 * Math.sin(air * Math.PI) },
    foot_r: { rx: 0.35 * Math.sin(air * Math.PI) }
  })
  shades(rig, true)
}

/** Sit back down: legs fold, leaf puff at 0.45 s, settle into the idle pose. */
function sitDown(t, rig) {
  const fold = seq(t, [
    [0.15, 0],
    [0.55, 1]
  ])
  const settle = seq(t, [
    [0.55, 0],
    [0.9, 1]
  ])

  rig.set(POSE_STAND_CUSHION)
  // anticipation sink
  rig.set({
    hips: { py: lerp(STAND_HIPS_Y, STAND_HIPS_Y - 0.02, seq(t, [[0, 0], [0.15, 1]])) },
    spine: { rx: lerp(0, 0.14, seq(t, [[0, 0], [0.15, 1]])) }
  })
  // fold the legs away under the hem
  rig.set({
    hips: { py: t < 0.15 ? rig.frame.hips.py : lerp(STAND_HIPS_Y - 0.02, SEAT_HIPS_Y - 0.008, fold) },
    thigh_l: { rx: lerp(0, -1.25, fold), rz: lerp(0, 0.45, fold) },
    thigh_r: { rx: lerp(0, -1.25, fold), rz: lerp(0, -0.45, fold) },
    foot_l: { rx: lerp(0, 1.15, fold), rz: lerp(0, -0.15, fold) },
    foot_r: { rx: lerp(0, 1.15, fold), rz: lerp(0, 0.15, fold) },
    spine: { rx: t < 0.15 ? rig.frame.spine.rx : lerp(0.14, 0.05, fold) },
    arm_l: { rx: lerp(0, -0.5, fold), rz: lerp(-0.12, -0.34, fold) },
    arm_r: { rx: lerp(0, -0.5, fold), rz: lerp(0.12, 0.34, fold) }
  })
  // settle into the idle seated pose
  rig.set({
    hips: { py: t < 0.55 ? rig.frame.hips.py : lerp(SEAT_HIPS_Y - 0.008, SEAT_HIPS_Y, settle) },
    head: { rx: lerp(0, 0.06, settle) },
    hand_l: { rx: lerp(0, 0.42, settle) },
    hand_r: { rx: lerp(0, -0.45, settle) },
    arm_r: {
      rx: t < 0.55 ? rig.frame.arm_r.rx : lerp(-0.5, -1.9, settle),
      rz: t < 0.55 ? rig.frame.arm_r.rz : lerp(0.34, 0.5, settle)
    }
  })
  shades(rig, true)
}

/**
 * The waddle (§3.5): body rocks side to side, arms swing opposite, feet arc up.
 * One full cycle per 0.7 s clip, perfectly loopable.
 */
function walk(t, rig, duration, direction = 1) {
  const w = (t / duration) * Math.PI * 2
  rig.set(POSE_STAND_FLOOR)
  const swing = Math.sin(w)
  const bob = Math.cos(2 * w)
  rig.set({
    hips: { py: STAND_HIPS_Y + 0.012 * bob, px: 0.014 * swing },
    spine: { rz: 0.06 * swing, rx: -0.04 },
    chest: { rz: 0.035 * swing },
    head: { rz: -0.035 * swing, py: 0.225 + 0.008 * bob, rx: -0.02 },
    thigh_l: { rx: 0.45 * swing },
    thigh_r: { rx: -0.45 * swing },
    foot_l: { rx: -0.28 * Math.sin(w - 0.7) },
    foot_r: { rx: -0.28 * Math.sin(w + Math.PI - 0.7) },
    arm_l: { rx: -0.10 - 0.38 * swing, rz: -0.12 },
    arm_r: { rx: -0.10 + 0.38 * swing, rz: 0.12 },
    hand_l: { rx: -0.25 * swing },
    hand_r: { rx: 0.25 * swing },
    topknot: { py: 0.20, pz: -0.05 + 0.02 * Math.sin(w - 1.2) }
  })
  if (direction < 0) {
    // mirrored waddle: the walk clip is played with the actor facing -X, so the
    // lead leg simply swaps.
    rig.set({
      thigh_l: { rx: -0.45 * swing },
      thigh_r: { rx: 0.45 * swing },
      foot_l: { rx: -0.28 * Math.sin(w + Math.PI - 0.7) },
      foot_r: { rx: -0.28 * Math.sin(w - 0.7) },
      arm_l: { rx: -0.10 + 0.38 * swing },
      arm_r: { rx: -0.10 - 0.38 * swing }
    })
  }
  shades(rig, true)
}

function nod(t, rig) {
  rig.set(POSE_SIT)
  rig.set({
    head: {
      rx: seq(t, [
        [0, 0.06],
        [0.26, 0.32],
        [0.6, 0.06]
      ])
    },
    chest: {
      rx: seq(t, [
        [0, 0.02],
        [0.26, 0.11],
        [0.6, 0.02]
      ])
    },
    hand_r: { rx: seq(t, [
      [0, 0.35],
      [0.26, 0.15],
      [0.6, 0.35]
    ]) }
  })
  shades(rig, false)
}

/** Tier 0 distraction beat: he looks toward the offending window (§6.5). */
function glance(t, rig, duration, direction = 1) {
  const look = seq(t, [
    [0, 0],
    [0.3, 1],
    [0.52, 1],
    [0.8, 0]
  ])
  rig.set(POSE_SIT)
  rig.set({
    head: {
      ry: direction * 0.5 * look,
      rx: 0.06 - 0.07 * look,
      rz: direction * 0.06 * look
    },
    chest: { ry: direction * 0.14 * look, rx: 0.02 + 0.03 * look },
    neck: { rx: -0.02 - 0.04 * look },
    shoulder_l: { py: 0.09 + 0.006 * look },
    shoulder_r: { py: 0.09 + 0.006 * look }
  })
  shades(rig, false)
}

/** Anticipation before a laser blast: lenses glow, head lowers (§6.5). */
function shadesCharge(t, rig) {
  rig.set(POSE_SIT)
  rig.set({
    head: {
      rx: seq(t, [
        [0, 0.06],
        [0.3, 0.17]
      ])
    },
    chest: {
      rx: seq(t, [
        [0, 0.02],
        [0.3, 0.11]
      ]),
      sy: seq(t, [
        [0, 1],
        [0.3, 0.97]
      ])
    },
    shoulder_l: { py: seq(t, [
      [0, 0.09],
      [0.3, 0.075]
    ]) },
    shoulder_r: { py: seq(t, [
      [0, 0.09],
      [0.3, 0.075]
    ]) },
    arm_l: { rz: seq(t, [
      [0, -0.3],
      [0.3, -0.38]
    ]) },
    arm_r: { rz: seq(t, [
      [0, 0.3],
      [0.3, 0.38]
    ]) }
  })
  shades(rig, false)
}

export const CLIP_DEFS = [
  { name: 'idle_sit', duration: 4.0, loop: true, fn: idleSit },
  { name: 'meditate', duration: 5.0, loop: true, fn: meditate },
  { name: 'shades_off', duration: 0.8, loop: false, fn: shadesOff },
  { name: 'shades_on', duration: 0.6, loop: false, fn: shadesOn },
  { name: 'stand_up', duration: 1.0, loop: false, fn: standUp },
  { name: 'hop_off', duration: 0.6, loop: false, fn: hopOff },
  { name: 'walk', duration: 0.7, loop: true, fn: (t, rig, d) => walk(t, rig, d, 1) },
  { name: 'hop_on', duration: 0.6, loop: false, fn: hopOn },
  { name: 'sit_down', duration: 0.9, loop: false, fn: sitDown },
  { name: 'nod', duration: 0.6, loop: false, fn: nod },
  { name: 'shades_charge', duration: 0.3, loop: false, fn: shadesCharge },
  { name: 'glance', duration: 0.8, loop: false, fn: (t, rig, d) => glance(t, rig, d, 1) },
  /**
   * Companion to `glance`: the contract clip turns him toward the left, this
   * one mirrors it so he can aim at a window on either side. Same duration,
   * same shape, opposite sign.
   */
  { name: 'glance_right', duration: 0.8, loop: false, fn: (t, rig, d) => glance(t, rig, d, -1) },
  { name: 'walk_left', duration: 0.7, loop: true, fn: (t, rig, d) => walk(t, rig, d, -1) }
]

/* ------------------------------------------------------------------------ */
/* Geometry                                                                  */
/* ------------------------------------------------------------------------ */

function mesh(name, geometry, material, parent, transform) {
  const m = new THREE.Mesh(geometry, material)
  m.name = name
  if (transform) {
    m.position.set(...(transform.pos ?? [0, 0, 0]))
    m.rotation.set(...(transform.rot ?? [0, 0, 0]))
    m.scale.set(...(transform.scale ?? [1, 1, 1]))
  }
  m.castShadow = false
  m.receiveShadow = false
  parent.add(m)
  return m
}

export function buildBodhi({ PALETTE }) {
  const materials = {}
  const materialFor = (role) => {
    if (!materials[role]) {
      if (!(role in PALETTE)) {
        throw new Error(`unknown palette role "${role}"`)
      }
      const color = PALETTE[role]
      const m = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 1,
        metalness: 0,
        flatShading: false
      })
      m.name = `bodhi_${role}`
      materials[role] = m
    }
    return materials[role]
  }

  // bodhi_root (exported scene root) -> bodhi_scale (height normalisation)
  //   -> root (animated, BIND.root) -> hips -> ...
  const outer = new THREE.Object3D()
  outer.name = 'bodhi_root'
  const scaleWrapper = new THREE.Object3D()
  scaleWrapper.name = 'bodhi_scale'
  outer.add(scaleWrapper)
  const root = new THREE.Object3D()
  root.name = 'root'
  scaleWrapper.add(root)

  const hips = node('hips', root, BIND.hips)
  const spine = node('spine', hips, BIND.spine)
  const chest = node('chest', spine, BIND.chest)
  const neck = node('neck', chest, BIND.neck)
  const head = node('head', neck, BIND.head)
  const topknot = node('topknot', head, BIND.topknot)
  const shoulderL = node('shoulder_l', chest, BIND.shoulder_l)
  const shoulderR = node('shoulder_r', chest, BIND.shoulder_r)
  const armL = node('arm_l', shoulderL, BIND.arm_l)
  const armR = node('arm_r', shoulderR, BIND.arm_r)
  const handL = node('hand_l', armL, BIND.hand_l)
  const handR = node('hand_r', armR, BIND.hand_r)
  const thighL = node('thigh_l', hips, BIND.thigh_l)
  const thighR = node('thigh_r', hips, BIND.thigh_r)
  const footL = node('foot_l', thighL, BIND.foot_l)
  const footR = node('foot_r', thighR, BIND.foot_r)

  // --- head: squashed sphere with the ear lobes merged in (§3.2) -----------
  const headGeo = G.merge([
    G.transformed(G.sphere(0.225, 20, 16), { scale: [1.0, 0.92, 0.95] }),
    // ears: small, rounded, slightly elongated lobes
    G.transformed(G.sphere(0.075, 12, 10), { pos: [0.212, -0.02, -0.01], scale: [0.55, 1.45, 0.75] }),
    G.transformed(G.sphere(0.075, 12, 10), { pos: [-0.212, -0.02, -0.01], scale: [0.55, 1.45, 0.75] })
  ])
  mesh('bodhi_head:skinBase', headGeo, materialFor('skinBase'), head)

  // --- face: closed-eye arcs, a smile line, one dot for a nose (§3.2) ------
  const faceGeo = G.merge([
    G.transformed(G.arcUp(0.055, 0.012, 2.1), { pos: [0.085, 0.025, 0.205] }),
    G.transformed(G.arcUp(0.055, 0.012, 2.1), { pos: [-0.085, 0.025, 0.205] }),
    G.transformed(G.arcDown(0.038, 0.008, 1.7), { pos: [0, -0.10, 0.196] }),
    G.transformed(G.sphere(0.012, 6, 5), { pos: [0, -0.025, 0.198] })
  ])
  mesh('bodhi_face:outline', faceGeo, materialFor('outline'), head)

  // --- topknot with a single hair-curl bump -------------------------------
  const topknotGeo = G.merge([
    G.transformed(G.sphere(0.075, 12, 10), { scale: [1, 0.92, 1] }),
    G.transformed(G.sphere(0.028, 8, 6), { pos: [0.03, 0.055, -0.035] })
  ])
  mesh('bodhi_topknot:sash', topknotGeo, materialFor('sash'), topknot)

  // --- body: pear-shaped robe, draped over the left shoulder --------------
  const bodyProfile = [
    [0.20, -0.09],
    [0.26, -0.05],
    [0.30, 0.0],
    [0.295, 0.10],
    [0.265, 0.20],
    [0.225, 0.29],
    [0.195, 0.35],
    [0.10, 0.375],
    [0.0001, 0.38]
  ]
  const bodyGeo = G.merge([
    G.lathe(bodyProfile, 20),
    // the drape over his left shoulder (+X); his right shoulder stays bare
    G.transformed(G.sphere(0.18, 14, 10), { pos: [0.13, 0.30, 0.01], scale: [0.85, 0.62, 0.95] })
  ])
  mesh('bodhi_body:robeBase', bodyGeo, materialFor('robeBase'), hips)

  // --- sash at the waist ---------------------------------------------------
  const sashGeo = G.transformed(G.torus(0.285, 0.035, 6, 22), {
    pos: [0, 0.05, 0],
    rot: [Math.PI / 2, 0, 0],
    scale: [1, 1, 0.92]
  })
  mesh('bodhi_sash:sash', sashGeo, materialFor('sash'), hips)

  // --- arms and mitten hands ----------------------------------------------
  const armGeo = G.transformed(G.capsule(0.062, 0.066, 12, 4), { pos: [0, -0.085, 0] })
  const handGeo = G.transformed(G.sphere(0.075, 12, 10), { scale: [1, 0.92, 0.85] })
  mesh('bodhi_arm_l:skinBase', armGeo, materialFor('skinBase'), armL)
  mesh('bodhi_arm_r:skinBase', armGeo, materialFor('skinBase'), armR)
  mesh('bodhi_hand_l:skinBase', handGeo, materialFor('skinBase'), handL)
  mesh('bodhi_hand_r:skinBase', handGeo, materialFor('skinBase'), handR)

  // --- legs: stubby thighs under the robe, rounded feet --------------------
  const thighGeo = G.transformed(G.capsule(0.055, 0.012, 10, 3), { pos: [0, -0.06, 0] })
  const footGeo = G.transformed(G.sphere(0.07, 12, 8), { scale: [1, 0.55, 1.25] })
  mesh('bodhi_thigh_l:robeShade', thighGeo, materialFor('robeShade'), thighL)
  mesh('bodhi_thigh_r:robeShade', thighGeo, materialFor('robeShade'), thighR)
  mesh('bodhi_foot_l:skinBase', footGeo, materialFor('skinBase'), footL)
  mesh('bodhi_foot_r:skinBase', footGeo, materialFor('skinBase'), footR)

  // --- the signature shades (§3.1) ----------------------------------------
  const frameGeo = G.merge([
    G.transformed(G.torus(0.058, 0.017, 6, 18), { pos: [0.088, 0.025, 0.205], scale: [1.12, 0.88, 0.55] }),
    G.transformed(G.torus(0.058, 0.017, 6, 18), { pos: [-0.088, 0.025, 0.205], scale: [1.12, 0.88, 0.55] }),
    G.transformed(G.box(0.06, 0.016, 0.016), { pos: [0, 0.048, 0.205] }),
    G.transformed(G.box(0.014, 0.014, 0.12), { pos: [0.145, 0.02, 0.145] }),
    G.transformed(G.box(0.014, 0.014, 0.12), { pos: [-0.145, 0.02, 0.145] })
  ])
  const shadesWorn = node('shades_worn', head, {})
  mesh('bodhi_shades:shadesFrame', frameGeo, materialFor('shadesFrame'), shadesWorn)

  // lenses carry their own highlight dot, baked as a vertex colour so it costs
  // no extra draw call (§3.3)
  const lensGeo = G.merge([
    G.paint(G.transformed(G.box(0.086, 0.058, 0.010), { pos: [0.088, 0.025, 0.203] }), PALETTE.lensIdle),
    G.paint(G.transformed(G.box(0.086, 0.058, 0.010), { pos: [-0.088, 0.025, 0.203] }), PALETTE.lensIdle),
    G.paint(G.transformed(G.box(0.018, 0.014, 0.006), { pos: [0.108, 0.046, 0.209] }), PALETTE.lensHighlight),
    G.paint(G.transformed(G.box(0.018, 0.014, 0.006), { pos: [-0.068, 0.046, 0.209] }), PALETTE.lensHighlight)
  ])
  const lensMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 1,
    metalness: 0
  })
  lensMaterial.name = 'bodhi_lensVC'
  mesh('bodhi_lens:lensVC', lensGeo, lensMaterial, shadesWorn)

  // lens markers for the laser overlay (§6.6): parented to the head bone
  marker('lens_l', head, [-0.088, 0.025, 0.215])
  marker('lens_r', head, [0.088, 0.025, 0.215])

  // --- the shades hanging on his sash (shown only while he meditates) ------
  const shadesSash = node('shades_sash', hips, {
    px: -0.16,
    py: 0.04,
    pz: 0.17,
    rx: 0.35,
    ry: 0.5,
    rz: 0.9,
    sx: 0,
    sy: 0,
    sz: 0
  })
  mesh('bodhi_shades_sash:shadesFrame', frameGeo, materialFor('shadesFrame'), shadesSash, {
    scale: [0.85, 0.85, 0.85]
  })

  // Normalise: feet at y = 0, total height 1.0 (§4.1).
  normaliseHeight(root, scaleWrapper)

  const clips = CLIP_DEFS.map((def) =>
    bakeClip({
      name: def.name,
      duration: def.duration,
      bind: BIND,
      fn: (t, rig, duration) => def.fn(t, rig, duration)
    })
  )

  return { root: outer, clips, materials }
}

function node(name, parent, values = {}) {
  const o = new THREE.Object3D()
  o.name = name
  o.position.set(values.px ?? 0, values.py ?? 0, values.pz ?? 0)
  o.rotation.set(values.rx ?? 0, values.ry ?? 0, values.rz ?? 0)
  o.scale.set(values.sx ?? 1, values.sy ?? 1, values.sz ?? 1)
  parent.add(o)
  return o
}

function marker(name, parent, position) {
  const o = new THREE.Object3D()
  o.name = name
  o.position.set(...position)
  parent.add(o)
  return o
}

/**
 * Scale/offset the rig so the bind pose spans exactly y = 0..1. The wrapper
 * carries the correction, so clips keep animating `root` in authored units.
 */
function normaliseHeight(root, wrapper) {
  root.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(root)
  const height = box.max.y - box.min.y
  if (height <= 0) return
  const s = 1 / height
  wrapper.scale.setScalar(s)
  wrapper.position.set(0, -box.min.y * s, 0)
  return wrapper
}
