import { describe, expect, it } from 'vitest'
import {
  buildContainerLogsPath,
  isAllowedDockerApiRequest,
  isValidDockerLogFollow,
  isValidDockerLogTail,
  readContainerTtyFromInspect,
} from './containers'

describe('buildContainerLogsPath / whitelist', () => {
  it('only accepts four tails and boolean follow with fixed query order', () => {
    expect(buildContainerLogsPath('abc123', 200, true)).toBe(
      '/containers/abc123/logs?stdout=1&stderr=1&timestamps=0&tail=200&follow=1',
    )
    expect(buildContainerLogsPath('abc123', 100, false)).toBe(
      '/containers/abc123/logs?stdout=1&stderr=1&timestamps=0&tail=100&follow=0',
    )
    for (const t of [100, 200, 500, 1000] as const) {
      expect(isValidDockerLogTail(t)).toBe(true)
      expect(isAllowedDockerApiRequest('GET', buildContainerLogsPath('x', t, true))).toBe(true)
    }
    expect(isValidDockerLogTail(50)).toBe(false)
    expect(isValidDockerLogTail(300)).toBe(false)
    expect(isValidDockerLogFollow(true)).toBe(true)
    expect(isValidDockerLogFollow(1)).toBe(false)
  })

  it('rejects extra query, wrong order, wrong method, arbitrary path', () => {
    const good = buildContainerLogsPath('abc', 200, true)
    expect(isAllowedDockerApiRequest('GET', good)).toBe(true)
    expect(isAllowedDockerApiRequest('POST', good)).toBe(false)
    expect(
      isAllowedDockerApiRequest(
        'GET',
        '/containers/abc/logs?follow=1&stdout=1&stderr=1&timestamps=0&tail=200',
      ),
    ).toBe(false)
    expect(
      isAllowedDockerApiRequest(
        'GET',
        '/containers/abc/logs?stdout=1&stderr=1&timestamps=0&tail=200&follow=1&extra=1',
      ),
    ).toBe(false)
    expect(
      isAllowedDockerApiRequest(
        'GET',
        '/containers/abc/logs?stdout=1&stderr=1&timestamps=1&tail=200&follow=1',
      ),
    ).toBe(false)
    expect(isAllowedDockerApiRequest('GET', '/containers/abc/logs?tail=200')).toBe(false)
    expect(isAllowedDockerApiRequest('GET', '/containers/abc/logs')).toBe(false)
  })

  it('throws on invalid id/tail', () => {
    expect(() => buildContainerLogsPath('../x', 200, true)).toThrow()
    expect(() => buildContainerLogsPath('ok', 50 as any, true)).toThrow()
  })
})

describe('readContainerTtyFromInspect', () => {
  it('reads Config.Tty only', () => {
    expect(readContainerTtyFromInspect({ Config: { Tty: true } })).toBe(true)
    expect(readContainerTtyFromInspect({ Config: { Tty: false } })).toBe(false)
    expect(readContainerTtyFromInspect({})).toBe(false)
    expect(readContainerTtyFromInspect(null)).toBe(false)
  })
})
