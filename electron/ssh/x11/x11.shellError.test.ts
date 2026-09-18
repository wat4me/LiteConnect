import { describe, expect, it } from 'vitest'
import { isX11ShellRequestError } from './x11'

describe('isX11ShellRequestError', () => {
  it('detects ssh2 Unable to request X11', () => {
    expect(isX11ShellRequestError('Unable to request X11')).toBe(true)
    expect(isX11ShellRequestError('Shell error: Unable to request X11')).toBe(true)
  })

  it('detects generic x11 refuse / disabled wording', () => {
    expect(isX11ShellRequestError('X11 forwarding disabled')).toBe(true)
    expect(isX11ShellRequestError('X11 request failed')).toBe(true)
  })

  it('rejects unrelated shell errors', () => {
    expect(isX11ShellRequestError('Permission denied')).toBe(false)
    expect(isX11ShellRequestError('Connection reset')).toBe(false)
    expect(isX11ShellRequestError('')).toBe(false)
    expect(isX11ShellRequestError(null)).toBe(false)
  })
})
