import { describe, expect, it } from 'vitest'
import {
  ANIMATIONS_QUERY_SCRIPT,
  ANIMATIONS_QUERY_TIMEOUT_MS,
  SPI_GETCLIENTAREAANIMATION,
  parseAnimationsOutput,
  querySystemAnimations,
  resolveReduceMotion
} from '../src/main/systemSettings'
import type { CommandRunner } from '../src/main/systemSettings'

describe('parseAnimationsOutput', () => {
  it('reads the PowerShell answer', () => {
    expect(parseAnimationsOutput('TRUE')).toBe(true)
    expect(parseAnimationsOutput('FALSE')).toBe(false)
    expect(parseAnimationsOutput('  true\r\n')).toBe(true)
    expect(parseAnimationsOutput('false\n')).toBe(false)
  })

  it('returns null for anything it cannot read', () => {
    expect(parseAnimationsOutput('')).toBeNull()
    expect(parseAnimationsOutput('maybe')).toBeNull()
    expect(parseAnimationsOutput('Add-Type : error')).toBeNull()
    expect(parseAnimationsOutput('TRUE FALSE')).toBeNull()
  })
})

describe('resolveReduceMotion', () => {
  it('on and off are absolute', () => {
    expect(resolveReduceMotion('on', true)).toBe(true)
    expect(resolveReduceMotion('on', false)).toBe(true)
    expect(resolveReduceMotion('off', true)).toBe(false)
    expect(resolveReduceMotion('off', false)).toBe(false)
  })

  it('auto follows the system in reverse: animations off means reduce motion', () => {
    expect(resolveReduceMotion('auto', true)).toBe(false)
    expect(resolveReduceMotion('auto', false)).toBe(true)
  })

  it('defaults to animations on when the system answer is missing', () => {
    expect(resolveReduceMotion('auto')).toBe(false)
  })
})

const WINDOWS = { platform: 'win32' as NodeJS.Platform }

describe('querySystemAnimations', () => {
  it('never throws and defaults to animations on', async () => {
    const boom: CommandRunner = async () => {
      throw new Error('powershell is not on this box')
    }
    await expect(querySystemAnimations({ ...WINDOWS, run: boom })).resolves.toBe(true)
  })

  it('passes the answer through', async () => {
    const off: CommandRunner = async () => 'FALSE\n'
    await expect(querySystemAnimations({ ...WINDOWS, run: off })).resolves.toBe(false)
    const on: CommandRunner = async () => 'TRUE\n'
    await expect(querySystemAnimations({ ...WINDOWS, run: on })).resolves.toBe(true)
  })

  it('garbage reads as animations on, not as reduce motion', async () => {
    const junk: CommandRunner = async () => 'The term is not recognized'
    await expect(querySystemAnimations({ ...WINDOWS, run: junk })).resolves.toBe(true)
  })

  it('short-circuits off Windows without spawning anything', async () => {
    const spy: CommandRunner = async () => {
      throw new Error('should never run')
    }
    await expect(querySystemAnimations({ platform: 'linux', run: spy })).resolves.toBe(true)
    await expect(querySystemAnimations({ platform: 'darwin', run: spy })).resolves.toBe(true)
  })

  it('asks user32 for client-area animation, hidden and bounded', async () => {
    let seen: Parameters<CommandRunner> | null = null
    await querySystemAnimations({
      ...WINDOWS,
      run: async (...args) => {
        seen = args
        return 'TRUE'
      }
    })
    expect(seen).not.toBeNull()
    const [file, args, options] = seen as unknown as Parameters<CommandRunner>
    expect(file).toBe('powershell.exe')
    expect(args[0]).toBe('-NoProfile')
    expect(args[1]).toBe('-NonInteractive')
    expect(args[2]).toBe('-Command')
    expect(args[3]).toContain('SystemParametersInfo')
    // The query itself must never flash a console window at the user.
    expect(options.windowsHide).toBe(true)
    expect(options.timeout).toBeGreaterThan(0)
    expect(ANIMATIONS_QUERY_TIMEOUT_MS).toBeGreaterThan(0)
  })

  it('targets SPI_GETCLIENTAREAANIMATION', () => {
    expect(SPI_GETCLIENTAREAANIMATION).toBe(0x1042)
    // user32 wants the value, not the hex spelling (0x1042 === 4162).
    expect(ANIMATIONS_QUERY_SCRIPT).toContain(String(SPI_GETCLIENTAREAANIMATION))
    expect(ANIMATIONS_QUERY_SCRIPT).toContain('user32.dll')
    expect(ANIMATIONS_QUERY_SCRIPT).toContain('SystemParametersInfo')
  })

  it('is a self-contained script with no here-string to mangle', () => {
    // @' / '@ here-strings must start and end a line; they are easy to break
    // when a script is assembled from an array, so this one avoids them.
    expect(ANIMATIONS_QUERY_SCRIPT).not.toContain("@'")
    const lines = ANIMATIONS_QUERY_SCRIPT.split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatch(/^Add-Type -TypeDefinition '/)
    expect(lines[3]).toBe('if ($on) { "TRUE" } else { "FALSE" }')
  })
})
