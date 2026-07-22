import { describe, expect, it } from 'vitest'
import {
  canApplyContainerActionResult,
  canShowContainerActions,
  mapActionResultToFeedback,
  visibleContainerActions,
} from './dockerContainerActions'

describe('visibleContainerActions', () => {
  it('running shows stop and restart only', () => {
    expect(visibleContainerActions('running')).toEqual(['stop', 'restart'])
    expect(visibleContainerActions('Running')).toEqual(['stop', 'restart'])
  })

  it('stopped-like shows start only', () => {
    expect(visibleContainerActions('exited')).toEqual(['start'])
    expect(visibleContainerActions('created')).toEqual(['start'])
    expect(visibleContainerActions('dead')).toEqual(['start'])
  })

  it('paused/restarting/removing/unknown are conservative', () => {
    expect(visibleContainerActions('paused')).toEqual([])
    expect(visibleContainerActions('restarting')).toEqual([])
    expect(visibleContainerActions('removing')).toEqual([])
    expect(visibleContainerActions('unknown')).toEqual([])
    expect(visibleContainerActions('')).toEqual([])
  })
})

describe('canShowContainerActions', () => {
  it('requires docker available and ssh connected', () => {
    expect(canShowContainerActions({ dockerAvailable: true, sshConnected: true })).toBe(true)
    expect(canShowContainerActions({ dockerAvailable: false, sshConnected: true })).toBe(false)
    expect(canShowContainerActions({ dockerAvailable: true, sshConnected: false })).toBe(false)
  })
})

describe('mapActionResultToFeedback', () => {
  it('maps outcomes and stable codes without English parsing', () => {
    expect(
      mapActionResultToFeedback({ ok: true, result: { outcome: 'completed' } }),
    ).toBe('completed')
    expect(
      mapActionResultToFeedback({ ok: true, result: { outcome: 'already-in-state' } }),
    ).toBe('already-in-state')
    expect(mapActionResultToFeedback({ ok: false, code: 'container-not-found' })).toBe(
      'container-not-found',
    )
    expect(mapActionResultToFeedback({ ok: false, code: 'action-conflict' })).toBe(
      'action-conflict',
    )
    expect(mapActionResultToFeedback({ ok: false, code: 'permission-denied' })).toBe(
      'permission-denied',
    )
    expect(mapActionResultToFeedback({ ok: false, code: 'ssh-disconnected' })).toBe(
      'ssh-disconnected',
    )
    expect(mapActionResultToFeedback({ ok: false, code: 'generation-stale' })).toBe(
      'generation-stale',
    )
    expect(mapActionResultToFeedback({ ok: false, code: 'request-timeout' })).toBe(
      'request-timeout',
    )
    expect(mapActionResultToFeedback({ ok: false, code: 'request-failed' })).toBe(
      'request-failed',
    )
  })
})

describe('canApplyContainerActionResult', () => {
  it('rejects disposed, gen mismatch, session mismatch', () => {
    expect(
      canApplyContainerActionResult({
        disposed: true,
        resultSessionId: 's1',
        activeSessionId: 's1',
        ownerSessionId: 's1',
        resultGen: 1,
        currentGen: 1,
      }),
    ).toBe(false)
    expect(
      canApplyContainerActionResult({
        disposed: false,
        resultSessionId: 's1',
        activeSessionId: 's1',
        ownerSessionId: 's1',
        resultGen: 1,
        currentGen: 2,
      }),
    ).toBe(false)
    expect(
      canApplyContainerActionResult({
        disposed: false,
        resultSessionId: 's1',
        activeSessionId: 's2',
        ownerSessionId: 's1',
        resultGen: 1,
        currentGen: 1,
      }),
    ).toBe(false)
    expect(
      canApplyContainerActionResult({
        disposed: false,
        resultSessionId: 's1',
        activeSessionId: 's1',
        ownerSessionId: 's1',
        resultGen: 3,
        currentGen: 3,
      }),
    ).toBe(true)
  })
})
