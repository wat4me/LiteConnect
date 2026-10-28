import { describe, expect, it } from 'vitest'
import { resolveX11Mode } from './x11Policy'

describe('X11 defaults and explicit overrides', () => {
  it.each([{}, { x11Forwarding: false }])('enables automatic forwarding for legacy defaults %j', profile => {
    expect(resolveX11Mode(profile)).toBe('auto')
  })
  it('preserves explicit custom displays and new opt-outs', () => {
    expect(resolveX11Mode({ x11Forwarding: true })).toBe('custom')
    expect(resolveX11Mode({ x11Mode: 'off', x11Forwarding: true })).toBe('off')
    expect(resolveX11Mode({ x11Mode: 'auto' })).toBe('auto')
    expect(resolveX11Mode({ x11Mode: 'custom' })).toBe('custom')
  })
})
