import { describe, expect, it } from 'vitest'
import {
  applyLoadGlobalDangerousSql,
  applySaveGlobalDangerousSql,
  beginLoadGlobalDangerousSql,
  beginSaveGlobalDangerousSql,
  canToggleGlobalDangerousSql,
  initialGlobalDangerousSqlUi,
} from './globalDangerousSqlSetting'

describe('globalDangerousSqlSetting', () => {
  it('starts unknown so UI does not claim server state', () => {
    const s = initialGlobalDangerousSqlUi(true)
    expect(s.known).toBe(false)
    expect(canToggleGlobalDangerousSql(s)).toBe(false)
  })

  it('load success marks known', () => {
    let s = beginLoadGlobalDangerousSql(initialGlobalDangerousSqlUi())
    expect(s.loading).toBe(true)
    s = applyLoadGlobalDangerousSql(s, { ok: true, value: false })
    expect(s).toMatchObject({ known: true, value: false, loading: false, error: '' })
    expect(canToggleGlobalDangerousSql(s)).toBe(true)
  })

  it('load failure keeps unknown and surfaces error', () => {
    let s = beginLoadGlobalDangerousSql(initialGlobalDangerousSqlUi())
    s = applyLoadGlobalDangerousSql(s, { ok: false, error: 'offline' })
    expect(s.known).toBe(false)
    expect(s.loading).toBe(false)
    expect(s.error).toBe('offline')
    expect(canToggleGlobalDangerousSql(s)).toBe(false)
  })

  it('save failure reverts optimistic value', () => {
    let s = applyLoadGlobalDangerousSql(initialGlobalDangerousSqlUi(), {
      ok: true,
      value: true,
    })
    s = beginSaveGlobalDangerousSql(s, false)
    expect(s.value).toBe(false)
    expect(s.saving).toBe(true)
    s = applySaveGlobalDangerousSql(s, {
      ok: false,
      error: 'write failed',
      previousValue: true,
    })
    expect(s.value).toBe(true)
    expect(s.saving).toBe(false)
    expect(s.error).toBe('write failed')
    expect(s.known).toBe(true)
  })

  it('save success updates known value', () => {
    let s = applyLoadGlobalDangerousSql(initialGlobalDangerousSqlUi(), {
      ok: true,
      value: true,
    })
    s = beginSaveGlobalDangerousSql(s, false)
    s = applySaveGlobalDangerousSql(s, { ok: true, value: false })
    expect(s.value).toBe(false)
    expect(s.error).toBe('')
    expect(canToggleGlobalDangerousSql(s)).toBe(true)
  })
})
