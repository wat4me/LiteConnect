import { describe, expect, it } from 'vitest'
import { DockerMultiplexDemux, DockerMuxParseError, DockerRawLogStream } from './logMultiplex'

function frame(type: 1 | 2, payload: string | Buffer): Buffer {
  const p = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload
  const h = Buffer.alloc(8)
  h[0] = type
  h.writeUInt32BE(p.length, 4)
  return Buffer.concat([h, p])
}

describe('DockerMultiplexDemux', () => {
  it('demuxes stdout/stderr and multi-frame chunks', () => {
    const d = new DockerMultiplexDemux()
    const a = frame(1, 'out-a')
    const b = frame(2, 'err-b')
    const frames = d.push(Buffer.concat([a, b]))
    expect(frames).toEqual([
      { stream: 'stdout', payload: Buffer.from('out-a') },
      { stream: 'stderr', payload: Buffer.from('err-b') },
    ])
    expect(() => d.end()).not.toThrow()
  })

  it('handles header/payload split across chunks', () => {
    const d = new DockerMultiplexDemux()
    const full = frame(1, '你好')
    const mid = 5
    expect(d.push(full.subarray(0, mid))).toEqual([])
    const frames = d.push(full.subarray(mid))
    expect(frames).toHaveLength(1)
    expect(frames[0].stream).toBe('stdout')
    expect(frames[0].payload.toString('utf8')).toBe('你好')
    d.end()
  })

  it('rejects unknown stream type', () => {
    const d = new DockerMultiplexDemux()
    const h = Buffer.alloc(8)
    h[0] = 9
    h.writeUInt32BE(1, 4)
    expect(() => d.push(Buffer.concat([h, Buffer.from('x')]))).toThrow(DockerMuxParseError)
  })

  it('rejects non-zero reserved header bytes', () => {
    const d = new DockerMultiplexDemux()
    const h = Buffer.alloc(8)
    h[0] = 1
    h[2] = 1
    h.writeUInt32BE(1, 4)
    expect(() => d.push(Buffer.concat([h, Buffer.from('x')]))).toThrow(DockerMuxParseError)
  })

  it('rejects oversized frames', () => {
    const d = new DockerMultiplexDemux(16)
    const h = Buffer.alloc(8)
    h[0] = 1
    h.writeUInt32BE(100, 4)
    expect(() => d.push(h)).toThrow(DockerMuxParseError)
  })

  it('end fails on partial header (1-7 bytes)', () => {
    for (let n = 1; n <= 7; n++) {
      const d = new DockerMultiplexDemux()
      d.push(Buffer.alloc(n, 0))
      expect(() => d.end()).toThrow(DockerMuxParseError)
    }
  })

  it('end fails on truncated payload', () => {
    const d = new DockerMultiplexDemux()
    const full = frame(1, 'hello')
    d.push(full.subarray(0, full.length - 1))
    expect(() => d.end()).toThrow(DockerMuxParseError)
  })

  it('clean empty EOF succeeds', () => {
    const d = new DockerMultiplexDemux()
    expect(() => d.end()).not.toThrow()
  })
})

describe('DockerRawLogStream', () => {
  it('does not treat TTY raw bytes as multiplex headers', () => {
    const raw = new DockerRawLogStream()
    const fake = Buffer.from([1, 0, 0, 0, 0, 0, 0, 5, 0x61, 0x62, 0x63, 0x64, 0x65])
    const frames = raw.push(fake)
    expect(frames).toHaveLength(1)
    expect(frames[0].stream).toBe('stdout')
    expect(frames[0].payload.equals(fake)).toBe(true)
    expect(() => raw.end()).not.toThrow()
  })
})
