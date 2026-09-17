import { execFile } from 'node:child_process'
import type { ReduceMotionSetting } from '@shared/types'

/**
 * §6.3 "Reduce motion: auto" — follow the Windows *Show animations in Windows*
 * switch. Electron exposes no API for it, so we ask user32 once through a tiny
 * PowerShell P/Invoke.
 *
 * Anything that goes wrong (non-Windows, no PowerShell, timeout, compile
 * failure) resolves to "animations are ON", which means reduce motion OFF —
 * i.e. the default look. A missing shell must never silently change how the
 * pet moves.
 */

/** SPI_GETCLIENTAREAANIMATION — winuser.h, the "animations in windows" toggle. */
export const SPI_GETCLIENTAREAANIMATION = 0x1042

/**
 * One-line P/Invoke so the script needs no here-string. The type definition is
 * a PowerShell single-quoted string, so the C# double quotes pass through
 * untouched. Prints TRUE/FALSE on stdout and nothing else.
 */
export const ANIMATIONS_QUERY_SCRIPT = [
  'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;' +
    'public class BodhiSpi{[DllImport("user32.dll", SetLastError = true)]' +
    'public static extern bool SystemParametersInfo(uint a, uint b, out bool c, uint d);}\'',
  '$on = $true',
  '[void][BodhiSpi]::SystemParametersInfo(' + SPI_GETCLIENTAREAANIMATION + ', 0, [ref]$on, 0)',
  'if ($on) { "TRUE" } else { "FALSE" }'
].join('\n')

/** Pure: turn PowerShell's answer into a boolean, or null when unreadable. */
export function parseAnimationsOutput(stdout: string): boolean | null {
  const text = stdout.trim()
  if (/^TRUE$/i.test(text)) return true
  if (/^FALSE$/i.test(text)) return false
  return null
}

export type CommandRunner = (
  file: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean }
) => Promise<string>

const defaultRunner: CommandRunner = (file, args, options) =>
  new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout) => {
      if (error) reject(error)
      else resolve(String(stdout ?? ''))
    })
  })

export const ANIMATIONS_QUERY_TIMEOUT_MS = 5000

export interface AnimationsQueryOptions {
  /** injectable for tests */
  run?: CommandRunner
  platform?: NodeJS.Platform
}

/**
 * Ask Windows whether window animations are enabled. Resolves `true` when
 * animations are on (the normal case) and `true` on every failure path so the
 * app degrades to its default motion.
 */
export async function querySystemAnimations(
  options: AnimationsQueryOptions = {}
): Promise<boolean> {
  const platform = options.platform ?? process.platform
  if (platform !== 'win32') return true
  const run = options.run ?? defaultRunner
  try {
    const stdout = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', ANIMATIONS_QUERY_SCRIPT],
      { timeout: ANIMATIONS_QUERY_TIMEOUT_MS, windowsHide: true }
    )
    return parseAnimationsOutput(stdout) ?? true
  } catch {
    return true
  }
}

/** Pure: the only place the three-way setting becomes a boolean. */
export function resolveReduceMotion(
  setting: ReduceMotionSetting,
  systemAnimationsEnabled = true
): boolean {
  if (setting === 'on') return true
  if (setting === 'off') return false
  return !systemAnimationsEnabled
}
