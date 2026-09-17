import { SIZES, WALK } from '@shared/constants'
import { clamp } from '@shared/easing'
import type { PetPosition, WalkPathPayload } from '@shared/types'

/**
 * Walk planning (§4.6, §7.5). Pure geometry in display DIP coordinates.
 *
 * The pet never gets its own OS window: main plans the path, the stage renderer
 * animates the actor inside the single stage window.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface WalkPlan extends WalkPathPayload {
  /** total travel time including the eased ends (ms) */
  durationMs: number
  /** where the long-break scenic pause happens, if any */
  scenicStop: PetPosition | null
  /** how long the scenic pause lasts */
  scenicPauseMs: number
  easing: 'inOutQuad'
}

export interface WalkOptions {
  /** diorama root position, in display DIP */
  petPos: PetPosition
  workArea: Rect
  /** rendered pet width in DIP (for edge offsets) */
  petWidth: number
  /** half-width of the ground island, for the tree-scene stroll */
  islandHalfWidth: number
  longBreak: boolean
  /** reduce motion / fallback: stay inside the diorama (§4.6) */
  treeSceneStroll: boolean
}

/** The "desktop floor": bottom of the work area, never under the taskbar (§8). */
export function floorY(workArea: Rect): number {
  return workArea.y + workArea.height - SIZES.floorInset
}

/** Default resting spot: bottom-right, 30 px from the edges (§5.6). */
export function defaultPetPosition(workArea: Rect): PetPosition {
  return {
    x: workArea.x + workArea.width - SIZES.defaultMargin,
    y: floorY(workArea)
  }
}

function travelDuration(distance: number, speed: number): number {
  const v = Math.max(1, speed)
  // Ease-in/out over the first and last `easeMs` costs exactly one extra
  // `easeMs` compared with travelling the whole way at full speed.
  return (distance / v) * 1000 + WALK.easeMs
}

/** Which horizontal edge is farther away (§4.6): never crosses monitors. */
export function exitSide(petPos: PetPosition, workArea: Rect): 'left' | 'right' {
  const distanceToLeft = petPos.x - workArea.x
  const distanceToRight = workArea.x + workArea.width - petPos.x
  return distanceToLeft >= distanceToRight ? 'left' : 'right'
}

export function planWalkOut(options: WalkOptions): WalkPlan {
  const { petPos, workArea, petWidth, islandHalfWidth, longBreak, treeSceneStroll } = options
  const y = floorY(workArea)
  const speed = longBreak ? WALK.longBreakSpeed : WALK.shortBreakSpeed
  const half = petWidth / 2

  let to: PetPosition
  let scenicStop: PetPosition | null = null
  let scenicPauseMs = 0

  if (treeSceneStroll) {
    // Reduce motion / GPU fallback: stroll to the edge of the island and back.
    const side = exitSide(petPos, workArea)
    const offset = Math.max(20, islandHalfWidth - half)
    to = { x: petPos.x + (side === 'left' ? -offset : offset), y }
  } else {
    const side = exitSide(petPos, workArea)
    // Walk fully off the selected display; the absence is the product (§12).
    to = {
      x: side === 'left' ? workArea.x - half - 8 : workArea.x + workArea.width + half + 8,
      y
    }
    if (longBreak) {
      scenicStop = { x: (petPos.x + to.x) / 2, y }
      scenicPauseMs = WALK.scenicPauseMs
    }
  }

  const from: PetPosition = { x: petPos.x, y }
  const distance = Math.abs(to.x - from.x)

  return {
    from,
    to,
    speed,
    scenic: longBreak && !treeSceneStroll,
    treeSceneStroll,
    durationMs: travelDuration(distance, speed) + scenicPauseMs,
    scenicStop,
    scenicPauseMs,
    easing: 'inOutQuad'
  }
}

export function planWalkBack(options: WalkOptions): WalkPlan {
  const out = planWalkOut(options)
  return {
    ...out,
    from: out.to,
    to: options.treeSceneStroll ? { x: options.petPos.x, y: floorY(options.workArea) } : out.from
  }
}

/** Keep the diorama inside the work area with a comfort margin (§5.6). */
export function clampToWorkArea(pos: PetPosition, workArea: Rect, margin = SIZES.dragMargin): PetPosition {
  return {
    x: clamp(pos.x, workArea.x + margin, workArea.x + workArea.width - margin),
    y: clamp(pos.y, workArea.y + margin, workArea.y + workArea.height - margin)
  }
}

/** > 8 px inside a different display means "switch displays" (§5.6). */
export function displayContaining(
  point: PetPosition,
  displays: Array<{ id: number; workArea: Rect }>,
  inset = SIZES.displaySwitchInset
): number | null {
  for (const display of displays) {
    const { x, y, width, height } = display.workArea
    if (
      point.x >= x + inset &&
      point.x <= x + width - inset &&
      point.y >= y + inset &&
      point.y <= y + height - inset
    ) {
      return display.id
    }
  }
  return null
}

/** Pet height in DIP for a scale setting (§5.3). */
export function petHeightForScale(scale: number): number {
  // §5.3: 75/100/125/150% -> 82/110/137/165 px
  return Math.floor((SIZES.petHeight * scale) / 100)
}
