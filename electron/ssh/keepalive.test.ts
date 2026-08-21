import { describe, expect, it, vi } from 'vitest'
import {
  SSH_KEEPALIVE_COUNT_MAX,
  SSH_KEEPALIVE_DEFAULT_MS,
  SSH_KEEPALIVE_DETECT_MAX_MS,
  SSH_KEEPALIVE_MIN_MS,
  applySocketKeepalive,
  resolveSshKeepalive,
} from './keepalive'
import { clientCloseOutcome } from './connectLifecycle'

describe('resolveSshKeepalive', () => {
  it('defaults and caps so dead peers are detected within ~30s', () => {
    expect(resolveSshKeepalive()).toEqual({
      keepaliveInterval: SSH_KEEPALIVE_DEFAULT_MS,
      keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
    })
    expect(SSH_KEEPALIVE_DEFAULT_MS).toBe(SSH_KEEPALIVE_DETECT_MAX_MS)
    expect(resolveSshKeepalive(30_000).keepaliveInterval).toBe(SSH_KEEPALIVE_DETECT_MAX_MS)
    expect(resolveSshKeepalive(1_000).keepaliveInterval).toBe(SSH_KEEPALIVE_MIN_MS)
  })
})

describe('applySocketKeepalive', () => {
  it('enables TCP keepalive when the socket exists', () => {
    const setKeepAlive = vi.fn()
    applySocketKeepalive({ _sock: { setKeepAlive } }, 10_000)
    expect(setKeepAlive).toHaveBeenCalledWith(true, 10_000)
  })

  it('ignores a missing socket', () => {
    expect(() => applySocketKeepalive({}, 10_000)).not.toThrow()
  })
})

describe('clientCloseOutcome', () => {
  it('notifies a live session and rejects an unfinished handshake', () => {
    expect(clientCloseOutcome({ hasSession: true, settled: true })).toBe('notify-close')
    expect(clientCloseOutcome({ hasSession: false, settled: false })).toBe('reject-handshake')
    expect(clientCloseOutcome({ hasSession: false, settled: true })).toBe('ignore')
  })
})
