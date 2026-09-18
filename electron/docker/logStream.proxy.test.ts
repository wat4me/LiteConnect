import { describe, expect, it } from 'vitest'
import { mapLogResponseHeaders } from './logStream'
import { DOCKER_PROXY_ERROR_HEADER } from './transport'

describe('mapLogResponseHeaders', () => {
  it('prefers known proxy stable codes on 502', () => {
    for (const code of [
      'permission-denied',
      'transport-unsupported',
      'generation-stale',
      'socket-not-found',
    ] as const) {
      expect(
        mapLogResponseHeaders(502, {
          [DOCKER_PROXY_ERROR_HEADER.toLowerCase()]: code,
        }),
      ).toBe(code)
    }
  })

  it('unknown proxy header falls back to request-failed', () => {
    expect(
      mapLogResponseHeaders(502, {
        [DOCKER_PROXY_ERROR_HEADER.toLowerCase()]: 'not-a-real-code',
      }),
    ).toBe('request-failed')
  })

  it('maps plain 404/403 without proxy header', () => {
    expect(mapLogResponseHeaders(404, {})).toBe('container-not-found')
    expect(mapLogResponseHeaders(403, {})).toBe('permission-denied')
  })

  it('returns null for success status', () => {
    expect(mapLogResponseHeaders(200, {})).toBeNull()
  })
})
