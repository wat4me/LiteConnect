import { describe, expect, it } from 'vitest'
import { buildX11ServerArgs, candidateX11ExecutablePaths } from './x11Server'

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
    ])
  })
})
