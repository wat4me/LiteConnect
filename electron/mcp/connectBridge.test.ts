import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: () => null,
  },
}))

vi.mock('../window/windowRegistry', () => ({
  getPrimaryWindow: () => null,
}))

vi.mock('../utils/validation', () => ({
  safeWebContentsSend: vi.fn(),
}))

import { completeRendererConnect, requestRendererConnect } from './connectBridge'

describe('connectBridge', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('rejects when no window can complete the connection', async () => {
    await expect(requestRendererConnect('660e8400-e29b-41d4-a716-446655440000')).rejects.toThrow(
      'CONNECT_UNAVAILABLE',
    )
  })

  it('completeRendererConnect returns false for unknown requests', () => {
    expect(completeRendererConnect('missing', { sessionId: 'x' })).toBe(false)
  })
})
