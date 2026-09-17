import { screen } from 'electron'
import type { DisplayInfo, PetPosition } from '@shared/types'
import type { Rect } from './walkPath'

/**
 * Display handling (§5.6, §8): work areas in DIP (never `bounds`, so the pet can
 * never end up under the taskbar), mixed-DPI awareness, and unplug/re-plug
 * migration.
 */
export interface DisplayEntry {
  id: number
  primary: boolean
  workArea: Rect
  scaleFactor: number
  label: string
}

function toDisplayInfo(display: Electron.Display): DisplayInfo {
  const { x, y, width, height } = display.workArea
  return {
    id: display.id,
    label: `${Math.round(display.size.width)}×${Math.round(display.size.height)}`,
    primary: display.id === screen.getPrimaryDisplay().id,
    workArea: { x, y, width, height },
    scaleFactor: display.scaleFactor
  }
}

export function listDisplays(): DisplayInfo[] {
  return screen.getAllDisplays().map(toDisplayInfo)
}

export function allDisplays(): DisplayEntry[] {
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    primary: display.id === screen.getPrimaryDisplay().id,
    workArea: { ...display.workArea },
    scaleFactor: display.scaleFactor,
    label: `${Math.round(display.size.width)}×${Math.round(display.size.height)}`
  }))
}

/** The display to use: the saved one if it still exists, otherwise primary. */
export function resolveDisplay(preferredId: number | null): DisplayEntry {
  const displays = allDisplays()
  const match = preferredId == null ? undefined : displays.find((d) => d.id === preferredId)
  if (match) return match
  const primary = displays.find((d) => d.primary) ?? displays[0]
  return primary
}

export function displayById(id: number): DisplayEntry | undefined {
  return allDisplays().find((display) => display.id === id)
}

/** Window -> display DIP conversion for pointer events. */
export function windowToDisplay(display: DisplayEntry, point: PetPosition): PetPosition {
  return { x: display.workArea.x + point.x, y: display.workArea.y + point.y }
}

export function displayToWindow(display: DisplayEntry, point: PetPosition): PetPosition {
  return { x: point.x - display.workArea.x, y: point.y - display.workArea.y }
}

/** Which display contains a point (screen DIP), if any. */
export function displayAt(point: PetPosition): DisplayEntry | undefined {
  const all = allDisplays()
  return all.find(
    (display) =>
      point.x >= display.workArea.x &&
      point.x < display.workArea.x + display.workArea.width &&
      point.y >= display.workArea.y &&
      point.y < display.workArea.y + display.workArea.height
  )
}
