import { describe, expect, it, vi, beforeEach } from 'vitest'
import { ref, computed } from 'vue'
import { isNonRetryableSshError } from '@/utils/session/sshErrorRetry'

/**
 * Mirrors handleReconnect catch path: non-retryable errors must set nonRetryable
 * so TerminalTab does not reschedule auto-reconnect.
 */
function buildReconnectFailedDetail(sessionId: string, err: { message?: string }) {
  const message = err?.message || String(err)
  return {
    sessionId,
    message,
    nonRetryable: isNonRetryableSshError(message),
  }
}

describe('reconnect-failed non-retryable flag', () => {
  it('marks host key errors as nonRetryable', () => {
    const detail = buildReconnectFailedDetail('s1', {
      message: 'Connection error: [target host] Host key mismatch',
    })
    expect(detail.nonRetryable).toBe(true)
  })

  it('marks auth errors as nonRetryable', () => {
    const detail = buildReconnectFailedDetail('s1', {
      message: 'All configured authentication methods failed',
    })
    expect(detail.nonRetryable).toBe(true)
  })

  it('allows network errors to reschedule', () => {
    const detail = buildReconnectFailedDetail('s1', {
      message: 'Timed out while waiting for handshake',
    })
    expect(detail.nonRetryable).toBe(false)
  })
})

describe('host key confirm adopt vs resume', () => {
  it('adopts only when session is not already open', async () => {
    const open = new Set<string>()
    const adopted: Array<{ connectionId: string; sessionId: string }> = []

    async function onConfirm(connectionId: string, sessionId: string) {
      if (!open.has(sessionId)) {
        adopted.push({ connectionId, sessionId })
        open.add(sessionId)
      }
    }

    // first connect confirm
    await onConfirm('c1', 'sess-new')
    expect(adopted).toEqual([{ connectionId: 'c1', sessionId: 'sess-new' }])

    // reconnect confirm (tab already has sess-new)
    await onConfirm('c1', 'sess-new')
    expect(adopted).toHaveLength(1)
  })
})
