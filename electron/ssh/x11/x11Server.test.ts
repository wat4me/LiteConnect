import { describe, expect, it } from 'vitest'
import {
  buildX11ServerArgs,
  candidateX11ExecutablePaths,
  isChildProcessAlive,
} from './x11Server'
import type { ChildProcess } from 'child_process'

describe('x11Server candidates', () => {
  it('includes custom path first when provided', () => {
    const custom = 'D:\\Tools\\vcxsrv.exe'
    const list = candidateX11ExecutablePaths(custom)
    expect(list[0]).toBe(custom)
  })

  it('dedupes empty custom path', () => {
    const list = candidateX11ExecutablePaths('  ')
    expect(list.every((p) => p.trim().length > 0)).toBe(true)
  })
})

describe('VcXsrv startup arguments', () => {
  it('does not pass the unsupported -localhost option', () => {
    expect(buildX11ServerArgs('D:\\software\\VcXsrv\\vcxsrv.exe', 0)).toEqual([
      ':0',
      '-multiwindow',
      '-clipboard',
      '-wgl',
      '-ac',
      '-silent-dup-error',
    ])
  })
})

describe('isChildProcessAlive', () => {
  it('treats null and exited children as dead', () => {
    expect(isChildProcessAlive(null)).toBe(false)
    expect(
      isChildProcessAlive({ exitCode: 1, signalCode: null, killed: false } as ChildProcess),
    ).toBe(false)
    expect(
      isChildProcessAlive({ exitCode: null, signalCode: 'SIGTERM', killed: false } as ChildProcess),
    ).toBe(false)
  })

  it('treats running child as alive', () => {
    expect(
      isChildProcessAlive({ exitCode: null, signalCode: null, killed: false } as ChildProcess),
    ).toBe(true)
  })
})
