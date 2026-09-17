import * as THREE from 'three'
import { RENDER_RATES, SIZES, WALK } from '@shared/constants'
import { easeInOutQuad } from '@shared/easing'
import type { TimeOfDay } from '@shared/palette'
import { MINUTES_TO_MS, formatClock, resolveDuration } from '@shared/presets'
import type { AppState, Settings, Stats, WalkPathPayload } from '@shared/types'
import { BodhiActor } from './actor'
import { SoundBank } from './audio'
import { AuraRing, Particles } from './effects'
import { Hud } from './hud'
import { StageRenderer } from './renderer'
import { Diorama } from './sceneGraph'
import { makeGradientMap } from './toon'

/**
 * The stage window: a dumb view (§7.2). It owns no timers that decide anything
 * — main tells it which clip to play, where to walk and what the clock says,
 * and this file draws it.
 */
const canvas = document.getElementById('stage') as HTMLCanvasElement
const hudRoot = document.getElementById('hud') as HTMLElement

const renderer = new StageRenderer(canvas)
const hud = new Hud(hudRoot)
const sounds = new SoundBank()
const gradientMap = makeGradientMap()
const actor = new BodhiActor()
const diorama = new Diorama()
const particles = new Particles()
const aura = new AuraRing(SIZES.auraRadius, SIZES.auraThickness)

const scene = renderer.scene
scene.add(diorama.group)
scene.add(actor.group)
scene.add(particles.mesh)
scene.add(aura.mesh)

/** Display work area in DIP; every coordinate main sends us is display-absolute. */
let workArea = { x: 0, y: 0, width: 1920, height: 1080 }
let state: AppState | null = null
let settings: Settings | null = null
let petHeight: number = SIZES.petHeight
let atSeat = true
let breakUi = false
let hitTestEnabled = true
let lastLensReport = 0
let lastHoverReport = 0
let dragging = false
let dragStartScreen = { x: 0, y: 0 }
let hintText: string | null = null
let hintPosition = { x: 0, y: 0 }
/** resolved reduce-motion flag; 'on' here, and overwritten by main on 'auto' */
let reduceMotionResolved = false

/* ------------------------------------------------------------------ walking */

interface WalkState {
  active: boolean
  from: THREE.Vector3
  to: THREE.Vector3
  durationMs: number
  elapsed: number
  scenic: boolean
  scenicAt: number | null
  paused: number
  direction: -1 | 1
  lastPuff: number
}

const walk: WalkState = {
  active: false,
  from: new THREE.Vector3(),
  to: new THREE.Vector3(),
  durationMs: 0,
  elapsed: 0,
  scenic: false,
  scenicAt: null,
  paused: 0,
  direction: 1,
  lastPuff: 0
}

function screenToWorld(point: { x: number; y: number }, z = 0): THREE.Vector3 {
  return new THREE.Vector3(
    point.x - workArea.x,
    renderer.size.height - (point.y - workArea.y),
    z
  )
}

function startWalk(plan: WalkPathPayload & { durationMs: number; scenicStop: { x: number; y: number } | null }): void {
  walk.from = screenToWorld(plan.from, petHeight * 0.15)
  walk.to = screenToWorld(plan.to, petHeight * 0.15)
  walk.durationMs = plan.durationMs
  walk.elapsed = 0
  walk.scenic = plan.scenic
  walk.scenicAt = plan.scenicStop ? walk.durationMs / 2 : null
  walk.paused = 0
  walk.direction = walk.to.x >= walk.from.x ? 1 : -1
  walk.active = true
  actor.setFacing(walk.direction === 1 ? 1 : -1)
  actor.setShadowVisible(true)
  actor.play('walk', 0.2)
  actor.group.position.copy(walk.from)
}

/**
 * Distance travelled for a path that eases in and out over the first and last
 * `WALK.easeMs`, cruising at `speed` in between (§7.5).
 */
function distanceAt(elapsed: number, total: number, speed: number): number {
  const ease = WALK.easeMs / 1000
  const t = elapsed / 1000
  const totalSeconds = total / 1000
  const cruise = Math.max(0, totalSeconds - ease)
  if (t <= ease) return 0.5 * speed * (t * t) / ease
  if (t >= totalSeconds - ease) {
    const r = totalSeconds - t
    return speed * (cruise - ease / 2) + (speed * ease / 2 - 0.5 * speed * (r * r) / ease)
  }
  return 0.5 * speed * ease + speed * (t - ease)
}

function updateWalk(dt: number, now: number): void {
  if (!walk.active) return

  if (walk.paused > 0) {
    walk.paused -= dt * 1000
    if (walk.paused <= 0) {
      actor.setFacing(walk.direction === 1 ? 1 : -1)
      actor.play('walk', 0.2)
    } else {
      return
    }
  }

  walk.elapsed += dt * 1000
  const cruiseMs = walk.durationMs - WALK.easeMs
  const speed = (walk.to.distanceTo(walk.from) / Math.max(1, cruiseMs)) * 1000
  const travelled = distanceAt(Math.min(walk.elapsed, walk.durationMs), walk.durationMs, speed)
  const length = walk.to.distanceTo(walk.from) || 1
  const progress = Math.max(0, Math.min(1, travelled / length))

  // Scenic stroll: stop halfway, glance around, carry on (§4.6).
  if (walk.scenicAt != null && walk.elapsed >= walk.scenicAt && walk.paused === 0) {
    walk.paused = WALK.scenicPauseMs
    actor.setFacing(0)
    actor.play('glance', 0.25)
    walk.elapsed = walk.scenicAt
    return
  }

  actor.group.position.lerpVectors(walk.from, walk.to, easeInOutQuad(progress))
  // A little hop in the step: the walk clip already bobs him, this adds drift.
  actor.group.position.z = petHeight * 0.15

  walk.lastPuff = particles.maybeFootfall(
    now,
    walk.lastPuff,
    actor.group.position.clone().add(new THREE.Vector3(0, -petHeight * 0.5, 0)),
    petHeight / SIZES.petHeight
  )

  if (walk.elapsed >= walk.durationMs) {
    walk.active = false
    actor.group.position.copy(walk.to)
  }
}

/* -------------------------------------------------------------- placement */

function placeDiorama(): void {
  if (!state) return
  diorama.group.position.copy(screenToWorld(state.petPos))
}

function placeActorAtSeat(): void {
  actor.setFacing(0)
  actor.group.position.copy(diorama.group.position).add(diorama.seatOffset)
  actor.setShadowVisible(false)
}

function applyScale(): void {
  if (!settings) return
  petHeight = Math.round((SIZES.petHeight * settings.scale) / 100)
  actor.setHeight(petHeight)
  diorama.setHeight(petHeight)
}

/* ---------------------------------------------------------------- effects */

function focusDurationMs(): number {
  if (!settings) return 25 * MINUTES_TO_MS
  return resolveDuration(settings.preset, settings.custom).focus * MINUTES_TO_MS
}

function updateAura(): void {
  if (!state) return
  const showing = state.phase === 'focus'
  aura.setVisible(showing)
  if (!showing) return
  const total = focusDurationMs()
  const remaining = state.endsAt ? Math.max(0, state.endsAt - Date.now()) : state.remainingMs ?? total
  aura.setProgress(1 - Math.max(0, Math.min(1, remaining / total)))
  aura.setDimmed(state.paused)
  const seat = diorama.group.position.clone().add(diorama.seatOffset)
  aura.mesh.position.set(seat.x, seat.y + petHeight * 0.55, seat.z - petHeight * 0.35)
  aura.mesh.scale.setScalar(petHeight / SIZES.petHeight)
}

function updateAmbientParticles(dt: number, now: number): void {
  const phase = state?.phase ?? 'idle'
  const paused = state?.paused ?? false
  const leafBudget = phase === 'focus' && !paused ? 20 : 0
  const canopy = diorama.group.position.clone().add(diorama.canopyOffset)

  particles.update(dt, now, {
    leafBudget,
    canopy,
    canopySpread: diorama.canopySpread,
    scale: petHeight / SIZES.petHeight,
    gustEveryMs: 20_000
  })

  // Night fireflies (§4.5) and blossoms from bloom stage 2 (§4.5).
  const night = renderer.currentTimeOfDay === 'night'
  if (night && particles.countKind('firefly') < 5) {
    particles.spawnFirefly(canopy, diorama.canopySpread, petHeight / SIZES.petHeight)
  }
  if (!night) particles.clearKind('firefly')
}

function updateBlossoms(): void {
  const stage = state?.bloomStage ?? 0
  const wanted = stage >= 2 ? stage * 4 : 0
  const have = particles.countKind('blossom')
  const scale = petHeight / SIZES.petHeight
  if (wanted > have) {
    const canopy = diorama.group.position.clone().add(diorama.canopyOffset)
    for (let i = have; i < wanted; i++) {
      particles.spawnBlossom(
        canopy
          .clone()
          .add(
            new THREE.Vector3(
              (Math.random() - 0.5) * diorama.canopySpread,
              (Math.random() - 0.35) * diorama.canopySpread * 0.5,
              (Math.random() - 0.5) * diorama.canopySpread * 0.5
            )
          ),
        scale
      )
    }
  } else if (wanted < have) {
    particles.clearKind('blossom')
  }
}

/* -------------------------------------------------------------------- HUD */

function updateHud(): void {
  if (!state) return
  const sign = diorama.group.position.clone().add(diorama.signOffset)
  const screen = renderer.worldToScreen(sign)

  if (breakUi) {
    const remaining = state.endsAt
      ? Math.max(0, state.endsAt - Date.now())
      : state.remainingMs
    hud.setCountdown(formatClock(remaining), screen.x, screen.y)
  } else {
    hud.setCountdown(null, screen.x, screen.y)
  }

  if (hintText) hud.setHint(hintText, hintPosition.x, hintPosition.y)
  else hud.setHint(null, 0, 0)
}

function hintForPhase(): string | null {
  if (!state) return null
  switch (state.phase) {
    case 'idle':
      return 'click to sit'
    case 'ready':
      return 'back — click to sit'
    case 'focus':
      // During focus we show the time only: a "click to pause" hint invites
      // accidental pauses (§6.2).
      return state.paused ? formatClock(state.remainingMs) : formatClock(state.remainingMs)
    default:
      return null
  }
}

/* -------------------------------------------------------------- main loop */

let last = performance.now()

function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now

  const phase = state?.phase ?? 'idle'
  const paused = state?.paused ?? false
  const reduceMotion = reduceMotionResolved

  // Phase-based frame caps (§5.7).
  if (phase === 'focus' || phase === 'break') renderer.setFpsCap(RENDER_RATES.focusFps)
  else if (phase === 'waking' || phase === 'walkingOut' || phase === 'returning')
    renderer.setFpsCap(RENDER_RATES.actionFps)
  else renderer.setFpsCap(RENDER_RATES.idleKeepAliveFps)

  const frozen = paused && (phase === 'focus' || phase === 'break')

  if (!frozen) {
    actor.update(dt)
    diorama.update(dt, now)
    if (!reduceMotion) updateWalk(dt, now)
    else if (walk.active) {
      // Reduce motion: he strolls to the island edge and back, no walking
      // across the screen (§4.6).
      updateWalk(dt, now)
    }
  }

  if (atSeat && !walk.active) placeActorAtSeat()

  // Paused focus freezes the world: no breathing, no falling leaves (§2.1).
  if (!frozen) {
    updateAmbientParticles(dt, now)
    updateBlossoms()
  }
  updateAura()
  updateHud()

  // Camera shake is motion: suppress it under reduce motion (§6.5).
  renderer.render(now)

  if (settings?.lasers && phase === 'focus' && now - lastLensReport > 100) {
    lastLensReport = now
    const lens = actor.lensPositions(renderer.size.height)
    if (lens) {
      window.api.setLensPositions({
        left: { x: lens.left.x, y: lens.left.y },
        right: { x: lens.right.x, y: lens.right.y }
      })
    }
  }

  requestAnimationFrame(frame)
}

/* ---------------------------------------------------------------- hit test */

const pointer = new THREE.Vector2()
const raycaster = new THREE.Raycaster()

function hitTest(clientX: number, clientY: number): { over: boolean; figure: boolean } {
  if (!hitTestEnabled) return { over: false, figure: false }
  const rect = canvas.getBoundingClientRect()
  const x = clientX - rect.left
  const y = clientY - rect.top

  // Cheap AABB first (§5.5), then a ray against the actor for accuracy.
  const actorBox = actor.worldBounds
  const worldPoint = renderer.screenToWorld(x, y, 100)
  const insideIsland = x >= diorama.group.position.x - diorama.islandHalfWidth &&
    x <= diorama.group.position.x + diorama.islandHalfWidth &&
    y >= renderer.size.height - (diorama.group.position.y + petHeight * 0.25) &&
    y <= renderer.size.height - (diorama.group.position.y - petHeight * 0.25)

  const insideActor =
    worldPoint.x >= actorBox.min.x &&
    worldPoint.x <= actorBox.max.x &&
    worldPoint.y >= actorBox.min.y &&
    worldPoint.y <= actorBox.max.y

  if (!insideActor && !insideIsland) return { over: false, figure: false }

  if (insideActor) {
    pointer.set((x / renderer.size.width) * 2 - 1, -(y / renderer.size.height) * 2 + 1)
    raycaster.setFromCamera(pointer, renderer.camera)
    const hits = raycaster.intersectObject(actor.group, true)
    if (hits.length > 0) return { over: true, figure: true }
  }
  return { over: true, figure: false }
}

window.addEventListener('pointermove', (event) => {
  const now = performance.now()
  if (now - lastHoverReport < 1000 / SIZES.hitTestHz) return
  lastHoverReport = now

  const result = hitTest(event.clientX, event.clientY)
  window.api.setHover({ over: result.over, figure: result.figure, x: event.clientX, y: event.clientY })
  hud.setPointer(result.figure)

  if (result.figure) {
    hintText = hintForPhase()
    hintPosition = { x: event.clientX, y: event.clientY - 12 }
  } else {
    hintText = null
  }
})

window.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  const result = hitTest(event.clientX, event.clientY)
  if (!result.figure) return
  dragging = true
  dragStartScreen = { x: event.clientX, y: event.clientY }
  window.api.dragStart({ x: event.clientX, y: event.clientY })
})

window.addEventListener('pointerup', (event) => {
  if (!dragging) return
  dragging = false
  const moved =
    Math.abs(event.clientX - dragStartScreen.x) + Math.abs(event.clientY - dragStartScreen.y)
  window.api.dragEnd({ x: event.clientX, y: event.clientY })
  if (moved > SIZES.dragThresholdPx) return
  window.api.petClick()
})

window.addEventListener('dblclick', () => window.api.petDoubleClick())
window.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  if (hitTest(event.clientX, event.clientY).figure) window.api.contextMenu()
})

/* --------------------------------------------------------------- IPC wiring */

function applyState(next: AppState): void {
  const previousPhase = state?.phase
  state = next
  placeDiorama()
  if (previousPhase !== next.phase) {
    if (next.phase === 'idle' || next.phase === 'ready') {
      atSeat = true
      walk.active = false
      placeActorAtSeat()
    }
    if (next.phase === 'walkingOut' || next.phase === 'returning') {
      atSeat = false
    }
    if (next.phase === 'break') {
      atSeat = false
      actor.group.visible = false
    } else {
      actor.group.visible = true
    }
    updateBlossoms()
  }
  if (state.bloomStage != null) diorama.setBloom(state.bloomStage)
  renderer.render(performance.now(), true)
}

function applySettings(next: Settings): void {
  settings = next
  // 'auto' is resolved by main and pushed straight back; until then it is off.
  reduceMotionResolved = next.reduceMotion === 'on'
  applyScale()
  placeDiorama()
  if (atSeat && !walk.active) placeActorAtSeat()
  renderer.setTimeOfDay(resolveTimeOfDaySetting(next))
  if (next.clickThrough) hud.setPointer(false)
  renderer.render(performance.now(), true)
}

function resolveTimeOfDaySetting(next: Settings): TimeOfDay {
  if (next.timeOfDay !== 'auto') return next.timeOfDay
  const hour = new Date().getHours()
  if (hour < 5 || hour >= 20) return 'night'
  if (hour < 8) return 'dawn'
  if (hour < 17) return 'day'
  return 'dusk'
}

window.api.onState(applyState)
window.api.onSettingsChanged(applySettings)
window.api.onTimerTick(() => {
  updateHud()
  updateAura()
})
window.api.onStatsChanged((_stats: Stats) => undefined)

window.api.onPlayClip(({ clip, crossfade }) => {
  actor.play(clip, crossfade)
  if (clip === 'shades_charge') actor.setCharge(true)
})
window.api.onWalkPath((plan) => startWalk(plan as WalkPathPayload & { durationMs: number; scenicStop: { x: number; y: number } | null }))
window.api.onHitTestEnable(({ on }) => {
  hitTestEnabled = on
  if (!on) hud.setPointer(false)
})
window.api.onTimeOfDay(({ timeOfDay }) => renderer.setTimeOfDay(timeOfDay as TimeOfDay))
window.api.onNudge(({ text }) => {
  const sign = diorama.group.position.clone().add(diorama.signOffset)
  const screen = renderer.worldToScreen(sign)
  hud.setNudge(breakUi ? text : null, screen.x, screen.y + 18)
})
window.api.onAtSeat(({ on }) => {
  atSeat = on
  if (on) placeActorAtSeat()
})
window.api.onBreakUi(({ on }) => {
  breakUi = on
  if (!on) hud.setNudge(null, 0, 0)
})
window.api.onBloom(({ stage }) => diorama.setBloom(stage))
window.api.onLensFrost(({ on }) => actor.setFrost(on))
window.api.onAudioPlay(({ sound, volume }) => void sounds.play(sound, volume))

window.api.onDisplayChanged((payload) => {
  workArea = payload.workArea
  renderer.resize(workArea.width, workArea.height, payload.scaleFactor)
  petHeight = Math.round((SIZES.petHeight * (payload.scale ?? 100)) / 100)
  applyScale()
  placeDiorama()
  if (atSeat && !walk.active) placeActorAtSeat()
})

// Camera shake for tier-3 blasts: the camera moves, never an OS window (§6.6).
window.api.onShake(({ px, ms }) => {
  if (reduceMotionResolved) return
  renderer.shake(px, ms)
})

/**
 * The setting can be 'auto'; main is the only one that can resolve it (§6.3),
 * so it pushes the answer down and this wins over the raw setting.
 */
window.api.onReduceMotion(({ on }) => {
  reduceMotionResolved = on
})

// "Return to the path" — a small pill, never a modal, never focus-stealing.
window.api.onPill(({ text, x, y }) => hud.flashPill(text, x, y))

/* -------------------------------------------------------------------- boot */

async function boot(): Promise<void> {
  renderer.resize(workArea.width, workArea.height)
  const [initialState, initialSettings] = await Promise.all([
    window.api.getState(),
    window.api.getSettings()
  ])
  applySettings(initialSettings)
  applyState(initialState)

  const [bodhiBytes, treeBytes] = await Promise.all([
    window.api.loadModel('bodhi'),
    window.api.loadModel('tree')
  ])

  await actor.load(bodhiBytes, gradientMap)
  await diorama.load(treeBytes, gradientMap)

  diorama.setBloom(initialState.bloomStage)
  applyScale()
  placeDiorama()
  placeActorAtSeat()
  sounds.preload(['bell', 'soft-bell', 'pew'])

  window.api.ready()
  requestAnimationFrame(frame)
}

void boot()
