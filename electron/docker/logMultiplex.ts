/**
 * Docker non-TTY multiplexed stream demux + TTY raw stream.
 * Header: byte0 stream type (1=stdout, 2=stderr), 1..3 MUST be 0, 4..7 BE payload length.
 */

import { DOCKER_LOG_MAX_FRAME_BYTES } from './types'

export type DockerMuxStreamType = 'stdout' | 'stderr'

export type DockerMuxFrame = {
  stream: DockerMuxStreamType
  payload: Buffer
}

export class DockerMuxParseError extends Error {
  readonly code: 'malformed-frame' | 'unknown-stream' | 'frame-too-large' | 'truncated'

  constructor(
    code: 'malformed-frame' | 'unknown-stream' | 'frame-too-large' | 'truncated',
    message: string,
  ) {
    super(message)
    this.name = 'DockerMuxParseError'
    this.code = code
  }
}

export type DockerStreamDemux = {
  push(chunk: Buffer): DockerMuxFrame[]
  /** EOF integrity check — throws if partial header/payload remains. */
  end(): void
  pendingBytes(): number
}

/**
 * Incremental demultiplexer for Docker multiplexed log frames.
 * Headers and payloads may span arbitrary network chunks; one chunk may hold many frames.
 */
export class DockerMultiplexDemux implements DockerStreamDemux {
  private buf = Buffer.alloc(0)
  private needHeader = true
  private stream: DockerMuxStreamType = 'stdout'
  private payloadRemain = 0
  private payloadParts: Buffer[] = []
  private readonly maxFrameBytes: number
  private ended = false

  constructor(maxFrameBytes: number = DOCKER_LOG_MAX_FRAME_BYTES) {
    this.maxFrameBytes = maxFrameBytes
  }

  push(chunk: Buffer): DockerMuxFrame[] {
    if (this.ended) return []
    if (!chunk.length) return []
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk)
    const frames: DockerMuxFrame[] = []
    while (true) {
      if (this.needHeader) {
        if (this.buf.length < 8) break
        const type = this.buf[0]
        if (this.buf[1] !== 0 || this.buf[2] !== 0 || this.buf[3] !== 0) {
          throw new DockerMuxParseError('malformed-frame', 'Multiplex reserved bytes must be zero')
        }
        if (type !== 1 && type !== 2) {
          throw new DockerMuxParseError('unknown-stream', `Unknown stream type ${type}`)
        }
        const len = this.buf.readUInt32BE(4)
        if (len > this.maxFrameBytes) {
          throw new DockerMuxParseError('frame-too-large', 'Docker log frame exceeds limit')
        }
        this.stream = type === 1 ? 'stdout' : 'stderr'
        this.payloadRemain = len
        this.payloadParts = []
        this.buf = this.buf.subarray(8)
        this.needHeader = false
        if (len === 0) {
          frames.push({ stream: this.stream, payload: Buffer.alloc(0) })
          this.needHeader = true
          continue
        }
      }
      if (!this.needHeader) {
        if (!this.buf.length && this.payloadRemain > 0) break
        const take = Math.min(this.buf.length, this.payloadRemain)
        if (take > 0) {
          this.payloadParts.push(this.buf.subarray(0, take))
          this.buf = this.buf.subarray(take)
          this.payloadRemain -= take
        }
        if (this.payloadRemain === 0) {
          const payload =
            this.payloadParts.length === 1
              ? this.payloadParts[0]
              : Buffer.concat(this.payloadParts)
          frames.push({ stream: this.stream, payload })
          this.payloadParts = []
          this.needHeader = true
          continue
        }
        break
      }
    }
    return frames
  }

  /**
   * EOF: must be between frames (needHeader && no pending header bytes).
   * Incomplete header or payload → truncated error.
   */
  end(): void {
    if (this.ended) return
    this.ended = true
    if (!this.needHeader) {
      throw new DockerMuxParseError('truncated', 'Truncated multiplex payload')
    }
    if (this.buf.length > 0) {
      throw new DockerMuxParseError('truncated', 'Truncated multiplex header')
    }
    if (this.payloadParts.length > 0 || this.payloadRemain > 0) {
      throw new DockerMuxParseError('truncated', 'Truncated multiplex payload')
    }
  }

  pendingBytes(): number {
    return this.buf.length + this.payloadParts.reduce((n, b) => n + b.length, 0)
  }
}

/** TTY raw stream: entire body is a single logical stream (stdout). */
export class DockerRawLogStream implements DockerStreamDemux {
  private ended = false

  push(chunk: Buffer): DockerMuxFrame[] {
    if (this.ended || !chunk.length) return []
    return [{ stream: 'stdout', payload: Buffer.from(chunk) }]
  }

  end(): void {
    this.ended = true
  }

  pendingBytes(): number {
    return 0
  }
}
