import { afterEach, expect, it, vi } from 'vitest'
import { abortAiChatStream, clearPendingToolApprovals, createAiStreamControl, resolveToolApproval, waitForToolApproval } from './streamControl'

afterEach(() => vi.useRealTimers())

it('keeps cancellation and approval ownership in the same lifecycle boundary', async () => {
  const control = createAiStreamControl('control-owner', 7)
  try {
    const approval = waitForToolApproval('control-owner', 'call', control.controller.signal)
    expect(resolveToolApproval('control-owner', 'call', true, 8)).toBe(false)
    expect(abortAiChatStream('control-owner', 8)).toBe(false)
    expect(control.controller.signal.aborted).toBe(false)
    expect(resolveToolApproval('control-owner', 'call', true, 7)).toBe(true)
    expect(await approval).toBe(true)
    expect(resolveToolApproval('control-owner', 'call', true, 7)).toBe(false)
  } finally { control.cleanup(); clearPendingToolApprovals('control-owner') }
})

it('settles pending approvals and removes timers/listeners when a request aborts', async () => {
  vi.useFakeTimers()
  const control = createAiStreamControl('control-abort', 7)
  try {
    const approval = waitForToolApproval('control-abort', 'call', control.controller.signal)
    expect(abortAiChatStream('control-abort', 7)).toBe(true)
    expect(await approval).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    expect(resolveToolApproval('control-abort', 'call', true, 7)).toBe(false)
  } finally { control.cleanup(); clearPendingToolApprovals('control-abort') }
})

it('cleans only the completed request, including request IDs sharing a prefix', async () => {
  vi.useFakeTimers()
  const first = createAiStreamControl('cleanup')
  const second = createAiStreamControl('cleanup-other')
  try {
    const a = waitForToolApproval('cleanup', 'a', first.controller.signal)
    const b = waitForToolApproval('cleanup-other', 'b', second.controller.signal)
    clearPendingToolApprovals('cleanup')
    expect(await a).toBe(false)
    expect(resolveToolApproval('cleanup-other', 'b', true)).toBe(true)
    expect(await b).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  } finally { first.cleanup(); second.cleanup(); clearPendingToolApprovals('cleanup'); clearPendingToolApprovals('cleanup-other') }
})
