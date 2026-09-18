import { describe, expect, it } from 'vitest'
import {
  DOCKER_AVAILABILITY_MESSAGES,
  mapCodeToAvailability,
  mapTransportErrorToAvailability,
  resolveSocketNotFound,
} from './availability'
import { DockerTransportError } from './types'

describe('mapCodeToAvailability', () => {
  it('maps socket-not-found conservatively to daemon-unavailable without install evidence', () => {
    expect(mapCodeToAvailability('socket-not-found')).toEqual({
      status: 'daemon-unavailable',
      message: DOCKER_AVAILABILITY_MESSAGES['daemon-unavailable'],
    })
  })

  it('maps daemon-unavailable / proxy-closed to daemon-unavailable message', () => {
    for (const code of ['daemon-unavailable', 'proxy-closed'] as const) {
      const r = mapCodeToAvailability(code)
      expect(r.status).toBe('daemon-unavailable')
      if (r.status === 'daemon-unavailable') {
        expect(r.message).toBe(DOCKER_AVAILABILITY_MESSAGES['daemon-unavailable'])
      }
    }
  })

  it('maps request-failed / request-timeout with distinct messages', () => {
    const failed = mapCodeToAvailability('request-failed')
    expect(failed.status).toBe('daemon-unavailable')
    if (failed.status === 'daemon-unavailable') {
      expect(failed.message).toBe(DOCKER_AVAILABILITY_MESSAGES['request-failed'])
    }
    const timeout = mapCodeToAvailability('request-timeout')
    expect(timeout.status).toBe('daemon-unavailable')
    if (timeout.status === 'daemon-unavailable') {
      expect(timeout.message).toBe(DOCKER_AVAILABILITY_MESSAGES['request-timeout'])
    }
  })

  it('maps permission-denied, transport-unsupported and socket-forward-failed with stable messages', () => {
    expect(mapCodeToAvailability('permission-denied')).toEqual({
      status: 'permission-denied',
      message: DOCKER_AVAILABILITY_MESSAGES['permission-denied'],
    })
    expect(mapCodeToAvailability('transport-unsupported')).toEqual({
      status: 'transport-unsupported',
      message: DOCKER_AVAILABILITY_MESSAGES['transport-unsupported'],
    })
    expect(mapCodeToAvailability('socket-forward-failed')).toEqual({
      status: 'socket-forward-failed',
      message: DOCKER_AVAILABILITY_MESSAGES['socket-forward-failed'],
    })
  })

  it('maps ssh-disconnected and generation-stale to ssh-disconnected', () => {
    expect(mapCodeToAvailability('ssh-disconnected')).toEqual({ status: 'ssh-disconnected' })
    expect(mapCodeToAvailability('generation-stale')).toEqual({ status: 'ssh-disconnected' })
  })
})

describe('resolveSocketNotFound', () => {
  it('returns not-installed only when presence is not-installed', () => {
    expect(resolveSocketNotFound('not-installed')).toEqual({ status: 'not-installed' })
  })

  it('returns daemon-unavailable when installed (daemon down, socket missing)', () => {
    expect(resolveSocketNotFound('installed')).toEqual({
      status: 'daemon-unavailable',
      message: DOCKER_AVAILABILITY_MESSAGES['daemon-unavailable'],
    })
  })

  it('returns daemon-unavailable when unknown (never false not-installed)', () => {
    expect(resolveSocketNotFound('unknown')).toEqual({
      status: 'daemon-unavailable',
      message: DOCKER_AVAILABILITY_MESSAGES['daemon-unavailable'],
    })
  })
})

describe('mapTransportErrorToAvailability', () => {
  it('uses DockerTransportError.code not English text', () => {
    const err = new DockerTransportError(
      'socket-not-found',
      'No such file or directory: /var/run/docker.sock',
      's1',
    )
    // Without install evidence, conservative daemon-unavailable
    expect(mapTransportErrorToAvailability(err).status).toBe('daemon-unavailable')
  })

  it('does not parse message body for branching', () => {
    const denied = new DockerTransportError('permission-denied', 'connect failed', 's1')
    const missing = new DockerTransportError('socket-not-found', 'connect failed', 's1')
    expect(mapTransportErrorToAvailability(denied).status).toBe('permission-denied')
    expect(mapTransportErrorToAvailability(missing).status).toBe('daemon-unavailable')
  })
})
