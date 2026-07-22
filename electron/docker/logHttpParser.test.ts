import { describe, expect, it } from 'vitest'
import { HttpStreamParseError, IncrementalHttpResponseParser } from './logHttpParser'

function feedSplits(raw: Buffer, at: number[]): Buffer[] {
  const chunks: Buffer[] = []
  let prev = 0
  for (const p of at) {
    if (p > prev && p < raw.length) {
      chunks.push(raw.subarray(prev, p))
      prev = p
    }
  }
  chunks.push(raw.subarray(prev))
  return chunks
}

describe('IncrementalHttpResponseParser', () => {
  it('parses headers and identity body across splits at every byte near boundary', () => {
    const body = Buffer.from('hello-log\n')
    const raw = Buffer.from(
      `HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`,
    )
    const full = Buffer.concat([raw, body])
    const sep = raw.length
    for (let cut = Math.max(1, sep - 3); cut <= sep + 3 && cut < full.length; cut++) {
      const p = new IncrementalHttpResponseParser()
      const out: Buffer[] = []
      for (const c of feedSplits(full, [cut])) {
        const r = p.push(c)
        out.push(...r.bodyChunks)
      }
      const end = p.end()
      out.push(...end.bodyChunks)
      expect(Buffer.concat(out).toString('utf8')).toBe('hello-log\n')
      expect(p.getHeaders()?.statusCode).toBe(200)
    }
  })

  it('parses chunked encoding with size/data/CRLF split arbitrarily', () => {
    const payload = 'line1\nline2\n'
    const chunked = Buffer.from(
      `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n` +
        `${payload.length.toString(16)}\r\n${payload}\r\n0\r\n\r\n`,
    )
    for (let cut = 1; cut < chunked.length; cut += Math.max(1, Math.floor(chunked.length / 17))) {
      const p = new IncrementalHttpResponseParser()
      const out: Buffer[] = []
      for (const c of feedSplits(chunked, [cut])) {
        const r = p.push(c)
        out.push(...r.bodyChunks)
      }
      const end = p.end()
      out.push(...end.bodyChunks)
      expect(Buffer.concat(out).toString('utf8')).toBe(payload)
    }
  })

  it('exposes headers on 404 without emitting body or secret text', () => {
    const raw = Buffer.from(
      `HTTP/1.1 404 Not Found\r\nContent-Length: 12\r\n\r\nsecret-body!`,
    )
    const p = new IncrementalHttpResponseParser()
    const r = p.push(raw)
    expect(r.httpError).toBe(true)
    expect(r.headers?.statusCode).toBe(404)
    expect(r.bodyChunks).toEqual([])
    expect(JSON.stringify(r)).not.toContain('secret')
  })

  it('exposes proxy error header on 502 without body', () => {
    const raw = Buffer.from(
      `HTTP/1.1 502 Bad Gateway\r\n` +
        `x-liteconnect-docker-error: permission-denied\r\n` +
        `Content-Length: 18\r\n\r\nsecret-proxy-body!`,
    )
    const p = new IncrementalHttpResponseParser()
    const r = p.push(raw)
    expect(r.httpError).toBe(true)
    expect(r.headers?.statusCode).toBe(502)
    expect(r.headers?.headers['x-liteconnect-docker-error']).toBe('permission-denied')
    expect(r.bodyChunks).toEqual([])
    expect(JSON.stringify(r)).not.toContain('secret')
  })

  it('connection-close body without content-length', () => {
    const p = new IncrementalHttpResponseParser()
    const r1 = p.push(Buffer.from('HTTP/1.1 200 OK\r\nConnection: close\r\n\r\nabc'))
    expect(r1.headers?.statusCode).toBe(200)
    expect(Buffer.concat(r1.bodyChunks).toString()).toBe('abc')
    const r2 = p.push(Buffer.from('def'))
    expect(Buffer.concat(r2.bodyChunks).toString()).toBe('def')
    const end = p.end()
    expect(end.complete).toBe(true)
  })

  it('truncated headers fail safely', () => {
    const p = new IncrementalHttpResponseParser()
    p.push(Buffer.from('HTTP/1.1 200 OK\r\nCont'))
    expect(() => p.end()).toThrow(HttpStreamParseError)
  })

  it('truncated content-length fails on end', () => {
    const p = new IncrementalHttpResponseParser()
    p.push(Buffer.from('HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\nshort'))
    expect(() => p.end()).toThrow(HttpStreamParseError)
  })

  it('truncated chunked fails on end', () => {
    const payload = 'hello'
    // missing zero chunk
    const raw = Buffer.from(
      `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n` +
        `${payload.length.toString(16)}\r\n${payload}\r\n`,
    )
    const p = new IncrementalHttpResponseParser()
    p.push(raw)
    expect(() => p.end()).toThrow(HttpStreamParseError)
  })

  it('chunked missing last data byte fails on end', () => {
    const raw = Buffer.from(
      `HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n` + `5\r\nhell`,
    )
    const p = new IncrementalHttpResponseParser()
    p.push(raw)
    expect(() => p.end()).toThrow(HttpStreamParseError)
  })
})
