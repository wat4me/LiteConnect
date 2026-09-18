import { describe, expect, it } from 'vitest'
import {
  rewriteOtherWritableAnsi,
  rewriteOtherWritableSgrParams,
} from './otherWritableAnsi'

describe('rewriteOtherWritableSgrParams', () => {
  it('rewrites classic ow=34;42 to black on green', () => {
    expect(rewriteOtherWritableSgrParams('34;42')).toBe('30;42')
  })

  it('rewrites bold blue on green', () => {
    // Leading zeros normalize (01 → 1); SGR treats them the same
    expect(rewriteOtherWritableSgrParams('01;34;42')).toBe('1;30;42')
    expect(rewriteOtherWritableSgrParams('1;34;42')).toBe('1;30;42')
  })

  it('rewrites bright blue on bright green bg', () => {
    expect(rewriteOtherWritableSgrParams('94;102')).toBe('90;102')
  })

  it('leaves plain green / plain blue alone', () => {
    expect(rewriteOtherWritableSgrParams('32')).toBe('32')
    expect(rewriteOtherWritableSgrParams('34')).toBe('34')
    expect(rewriteOtherWritableSgrParams('42')).toBe('42')
    expect(rewriteOtherWritableSgrParams('1;32')).toBe('1;32')
  })

  it('leaves red-on-green alone', () => {
    expect(rewriteOtherWritableSgrParams('31;42')).toBe('31;42')
  })
})

describe('rewriteOtherWritableAnsi', () => {
  it('rewrites embedded CSI sequences only', () => {
    const input = 'a\x1b[34;42m777dir\x1b[0m b\x1b[32mfile\x1b[0m'
    const out = rewriteOtherWritableAnsi(input)
    expect(out).toBe('a\x1b[30;42m777dir\x1b[0m b\x1b[32mfile\x1b[0m')
  })

  it('is a no-op without escapes', () => {
    expect(rewriteOtherWritableAnsi('hello')).toBe('hello')
  })
})
