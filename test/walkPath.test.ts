import { describe, expect, it } from 'vitest'
import {
  clampToWorkArea,
  defaultPetPosition,
  displayContaining,
  exitSide,
  floorY,
  petHeightForScale,
  planWalkBack,
  planWalkOut,
  type WalkOptions
} from '@main/walkPath'
import { SIZES, WALK } from '@shared/constants'

/** A 1920x1080 work area with a 40 px taskbar at the bottom. */
const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 }

/** A monitor to the left of primary, which makes coordinates negative. */
const LEFT_MONITOR = { x: -2560, y: 0, width: 2560, height: 1400 }

function options(over: Partial<WalkOptions> = {}): WalkOptions {
  return {
    petPos: defaultPetPosition(PRIMARY),
    workArea: PRIMARY,
    petWidth: 90,
    islandHalfWidth: 100,
    longBreak: false,
    treeSceneStroll: false,
    ...over
  }
}

describe('floor and default placement', () => {
  it('walks on the work-area floor, never under the taskbar', () => {
    expect(floorY(PRIMARY)).toBe(1040 - SIZES.floorInset)
  })

  it('defaults to bottom-right, 30 px from the edges', () => {
    const pos = defaultPetPosition(PRIMARY)
    expect(pos).toEqual({ x: 1920 - SIZES.defaultMargin, y: 1040 - SIZES.floorInset })
  })

  it('handles negative work-area origins (monitor left of primary)', () => {
    expect(floorY(LEFT_MONITOR)).toBe(1400 - SIZES.floorInset)
    const pos = defaultPetPosition(LEFT_MONITOR)
    expect(pos.x).toBe(-2560 + 2560 - SIZES.defaultMargin)
  })
})

describe('exit side', () => {
  it('always heads for the farther horizontal edge', () => {
    expect(exitSide({ x: 1800, y: 0 }, PRIMARY)).toBe('left')
    expect(exitSide({ x: 100, y: 0 }, PRIMARY)).toBe('right')
    expect(exitSide({ x: 960, y: 0 }, PRIMARY)).toBe('left') // tie goes left
  })

  it('never crosses monitors: the exit stays inside the selected display', () => {
    const plan = planWalkOut(options({ petPos: { x: 1800, y: 0 } }))
    expect(plan.to.x).toBeLessThan(PRIMARY.x)
    // ...by just enough to be fully off-screen, not by a monitor width
    expect(plan.to.x).toBeGreaterThan(PRIMARY.x - 200)
  })

  it('exits right when the pet sits on the left', () => {
    const plan = planWalkOut(options({ petPos: { x: 100, y: 0 } }))
    expect(plan.to.x).toBeGreaterThan(PRIMARY.x + PRIMARY.width)
  })
})

describe('planned walk', () => {
  it('travels along the floor line', () => {
    const plan = planWalkOut(options())
    expect(plan.from.y).toBe(floorY(PRIMARY))
    expect(plan.to.y).toBe(floorY(PRIMARY))
  })

  it('costs distance / speed plus one ease window', () => {
    const petPos = { x: 1000, y: 0 }
    const plan = planWalkOut(options({ petPos }))
    const distance = Math.abs(plan.to.x - 1000)
    expect(plan.durationMs).toBeCloseTo((distance / WALK.shortBreakSpeed) * 1000 + WALK.easeMs, 5)
  })

  it('long breaks are slower and scenic', () => {
    const short = planWalkOut(options())
    const long = planWalkOut(options({ longBreak: true }))
    expect(long.speed).toBe(WALK.longBreakSpeed)
    expect(long.scenic).toBe(true)
    expect(long.scenicStop).not.toBeNull()
    expect(long.scenicPauseMs).toBe(WALK.scenicPauseMs)
    expect(short.scenic).toBe(false)
  })

  it('tree-scene stroll stays visible on the island', () => {
    const plan = planWalkOut(options({ treeSceneStroll: true }))
    expect(plan.treeSceneStroll).toBe(true)
    expect(plan.scenic).toBe(false)
    expect(Math.abs(plan.to.x - plan.from.x)).toBeLessThan(200)
    expect(plan.to.x).toBeGreaterThan(PRIMARY.x)
    expect(plan.to.x).toBeLessThan(PRIMARY.x + PRIMARY.width)
  })

  it('returns along the same path it left by', () => {
    const out = planWalkOut(options({ petPos: { x: 1800, y: 0 } }))
    const back = planWalkBack(options({ petPos: { x: 1800, y: 0 } }))
    expect(back.from).toEqual(out.to)
    expect(back.to).toEqual(out.from)
  })

  it('tree-scene stroll returns to the diorama root', () => {
    const back = planWalkBack(options({ petPos: { x: 1800, y: 0 }, treeSceneStroll: true }))
    expect(back.to).toEqual({ x: 1800, y: floorY(PRIMARY) })
  })
})

describe('clamping and display switching', () => {
  it('keeps the diorama inside the work area with a margin', () => {
    expect(clampToWorkArea({ x: -500, y: 9999 }, PRIMARY)).toEqual({
      x: SIZES.dragMargin,
      y: 1040 - SIZES.dragMargin
    })
  })

  it('clamps relative to a negative-origin display', () => {
    const clamped = clampToWorkArea({ x: -3000, y: 500 }, LEFT_MONITOR)
    expect(clamped.x).toBe(-2560 + SIZES.dragMargin)
  })

  it('only switches display once the cursor is 8 px inside it', () => {
    const displays = [
      { id: 1, workArea: PRIMARY },
      { id: 2, workArea: LEFT_MONITOR }
    ]
    expect(displayContaining({ x: 500, y: 500 }, displays)).toBe(1)
    expect(displayContaining({ x: -4, y: 500 }, displays)).toBeNull() // inside the 8 px dead zone
    expect(displayContaining({ x: -100, y: 500 }, displays)).toBe(2)
  })

  it('tolerates a point outside every display', () => {
    expect(displayContaining({ x: 99999, y: 0 }, [{ id: 1, workArea: PRIMARY }])).toBeNull()
  })
})

describe('scale', () => {
  it('renders 110 px at 100% and scales linearly', () => {
    expect(petHeightForScale(100)).toBe(110)
    expect(petHeightForScale(75)).toBe(82)
    expect(petHeightForScale(125)).toBe(137)
    expect(petHeightForScale(150)).toBe(165)
  })
})
