/**
 * Incremental HTTP/1.1 response parser for Docker log streams.
 * Handles headers and chunked/non-chunked bodies split at arbitrary byte boundaries.
 *
 * HTTP error responses (status >= 400) still expose headers so callers can read
 * proxy stable-error headers before mapping status codes. Body is never emitted.
 */

export type HttpStreamParseErrorCode =
  | 'malformed-response'
  | 'http-error'
  | 'truncated'

export class HttpStreamParseError extends Error {
  readonly code: HttpStreamParseErrorCode
  readonly statusCode?: number

  constructor(code: HttpStreamParseErrorCode, message: string, statusCode?: number) {
    super(message)
    this.name = 'HttpStreamParseError'
    this.code = code
    this.statusCode = statusCode
  }
}

export type HttpStreamHeaders = {
  statusCode: number
  headers: Record<string, string>
  chunked: boolean
  contentLength: number | null
}

export type HttpStreamParserResult = {
  /** Body bytes ready for the application (decoded if chunked). Never for HTTP errors. */
  bodyChunks: Buffer[]
  /** True after response fully consumed (chunked end or content-length or connection end after headers). */
  complete: boolean
  headers: HttpStreamHeaders | null
  /** True when status >= 400 was observed (headers available; no body chunks). */
  httpError: boolean
}

/**
 * Incremental HTTP response reader. Feed raw TCP chunks; never buffers entire body.
 */
export class IncrementalHttpResponseParser {
  private buf = Buffer.alloc(0)
  private headers: HttpStreamHeaders | null = null
  private bodyMode: 'none' | 'chunked' | 'length' | 'until-close' | 'discard-error' = 'none'
  private remainingLength = 0
  private chunkState: 'size' | 'data' | 'data-crlf' | 'trailers' = 'size'
  private chunkRemain = 0
  private complete = false
  private failed = false
  private httpError = false

  push(chunk: Buffer): HttpStreamParserResult {
    if (this.failed) {
      return {
        bodyChunks: [],
        complete: this.complete,
        headers: this.headers,
        httpError: this.httpError,
      }
    }
    if (this.complete && !this.httpError) {
      return {
        bodyChunks: [],
        complete: true,
        headers: this.headers,
        httpError: this.httpError,
      }
    }
    if (chunk.length) {
      this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : Buffer.from(chunk)
    }
    const bodyChunks: Buffer[] = []
    try {
      if (!this.headers) {
        const parsed = this.tryParseHeaders()
        if (!parsed) {
          return { bodyChunks: [], complete: false, headers: null, httpError: false }
        }
        this.headers = parsed
        if (parsed.statusCode >= 400) {
          // Headers available for proxy error code; discard body without emitting.
          this.httpError = true
          this.bodyMode = 'discard-error'
          this.discardErrorBody()
          return {
            bodyChunks: [],
            complete: this.complete,
            headers: this.headers,
            httpError: true,
          }
        }
      }
      if (this.bodyMode === 'discard-error') {
        this.discardErrorBody()
        return {
          bodyChunks: [],
          complete: this.complete,
          headers: this.headers,
          httpError: true,
        }
      }
      if (this.bodyMode === 'chunked') {
        this.readChunked(bodyChunks)
      } else if (this.bodyMode === 'length') {
        this.readLength(bodyChunks)
      } else if (this.bodyMode === 'until-close') {
        if (this.buf.length) {
          bodyChunks.push(this.buf)
          this.buf = Buffer.alloc(0)
        }
      }
    } catch (err) {
      this.failed = true
      throw err
    }
    return {
      bodyChunks,
      complete: this.complete,
      headers: this.headers,
      httpError: this.httpError,
    }
  }

  /**
   * Signal TCP end.
   * - until-close: completes cleanly
   * - length/chunked incomplete: throws truncated
   * - httpError discard: completes without body
   */
  end(): HttpStreamParserResult {
    if (this.failed) {
      return {
        bodyChunks: [],
        complete: this.complete,
        headers: this.headers,
        httpError: this.httpError,
      }
    }
    if (!this.headers) {
      this.failed = true
      throw new HttpStreamParseError('truncated', 'Truncated HTTP response (no headers)')
    }
    if (this.httpError || this.bodyMode === 'discard-error') {
      this.complete = true
      this.buf = Buffer.alloc(0)
      return {
        bodyChunks: [],
        complete: true,
        headers: this.headers,
        httpError: true,
      }
    }
    const bodyChunks: Buffer[] = []
    if (this.bodyMode === 'until-close') {
      if (this.buf.length) {
        bodyChunks.push(this.buf)
        this.buf = Buffer.alloc(0)
      }
      this.complete = true
    } else if (this.bodyMode === 'length') {
      if (this.remainingLength > 0) {
        this.failed = true
        throw new HttpStreamParseError('truncated', 'Truncated HTTP body')
      }
      this.complete = true
    } else if (this.bodyMode === 'chunked') {
      if (!this.complete) {
        this.failed = true
        throw new HttpStreamParseError('truncated', 'Truncated chunked body')
      }
    } else {
      this.complete = true
    }
    return {
      bodyChunks,
      complete: true,
      headers: this.headers,
      httpError: this.httpError,
    }
  }

  getHeaders(): HttpStreamHeaders | null {
    return this.headers
  }

  isHttpError(): boolean {
    return this.httpError
  }

  private discardErrorBody(): void {
    // Best-effort drain; never emit. Mark complete when buffer empty or length satisfied.
    if (this.headers?.chunked) {
      // Drop remaining; treat connection end as complete.
      this.buf = Buffer.alloc(0)
      return
    }
    if (this.headers?.contentLength != null) {
      const take = Math.min(this.buf.length, this.remainingLength)
      this.buf = this.buf.subarray(take)
      this.remainingLength -= take
      if (this.remainingLength <= 0) this.complete = true
      return
    }
    // until-close error body
    this.buf = Buffer.alloc(0)
  }

  private tryParseHeaders(): HttpStreamHeaders | null {
    const sep = this.buf.indexOf('\r\n\r\n')
    if (sep < 0) {
      if (this.buf.length > 64_000) {
        this.failed = true
        throw new HttpStreamParseError('malformed-response', 'HTTP headers too large')
      }
      return null
    }
    const head = this.buf.subarray(0, sep).toString('utf8')
    this.buf = this.buf.subarray(sep + 4)
    const lines = head.split('\r\n')
    const statusLine = lines[0] || ''
    const m = /^HTTP\/\d\.\d\s+(\d+)/i.exec(statusLine)
    if (!m) {
      this.failed = true
      throw new HttpStreamParseError('malformed-response', 'Invalid HTTP status line')
    }
    const statusCode = Number(m[1])
    const headers: Record<string, string> = {}
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]
      const idx = line.indexOf(':')
      if (idx < 0) continue
      const key = line.slice(0, idx).trim().toLowerCase()
      const val = line.slice(idx + 1).trim()
      headers[key] = val
    }
    const te = (headers['transfer-encoding'] || '').toLowerCase()
    const chunked = te.includes('chunked')
    let contentLength: number | null = null
    if (!chunked && headers['content-length'] !== undefined) {
      const n = parseInt(headers['content-length'], 10)
      if (!Number.isFinite(n) || n < 0) {
        this.failed = true
        throw new HttpStreamParseError('malformed-response', 'Invalid Content-Length')
      }
      contentLength = n
    }
    if (statusCode >= 400) {
      // Body will be discarded; track length if present.
      this.bodyMode = 'discard-error'
      if (!chunked && contentLength !== null) {
        this.remainingLength = contentLength
        if (contentLength === 0) this.complete = true
      }
      return { statusCode, headers, chunked, contentLength }
    }
    const bodylessStatus =
      (statusCode >= 100 && statusCode < 200) || statusCode === 204 || statusCode === 304
    if (bodylessStatus) {
      this.bodyMode = 'length'
      this.remainingLength = 0
      this.complete = true
    } else if (chunked) {
      this.bodyMode = 'chunked'
      this.chunkState = 'size'
    } else if (contentLength !== null) {
      this.bodyMode = 'length'
      this.remainingLength = contentLength
      if (contentLength === 0) this.complete = true
    } else {
      this.bodyMode = 'until-close'
    }
    return { statusCode, headers, chunked, contentLength }
  }

  private readLength(out: Buffer[]): void {
    if (this.remainingLength <= 0) {
      this.complete = true
      return
    }
    if (!this.buf.length) return
    const take = Math.min(this.buf.length, this.remainingLength)
    out.push(this.buf.subarray(0, take))
    this.buf = this.buf.subarray(take)
    this.remainingLength -= take
    if (this.remainingLength === 0) this.complete = true
  }

  private readChunked(out: Buffer[]): void {
    while (!this.complete) {
      if (this.chunkState === 'size') {
        const lineEnd = this.buf.indexOf('\r\n')
        if (lineEnd < 0) {
          if (this.buf.length > 64) {
            this.failed = true
            throw new HttpStreamParseError('malformed-response', 'Invalid chunk size line')
          }
          return
        }
        const sizeHex = this.buf.subarray(0, lineEnd).toString('utf8').trim()
        const semi = sizeHex.indexOf(';')
        const hex = semi >= 0 ? sizeHex.slice(0, semi).trim() : sizeHex
        if (!/^[0-9a-fA-F]+$/.test(hex)) {
          this.failed = true
          throw new HttpStreamParseError('malformed-response', 'Invalid chunk size')
        }
        const size = parseInt(hex, 16)
        if (!Number.isFinite(size) || size < 0) {
          this.failed = true
          throw new HttpStreamParseError('malformed-response', 'Invalid chunk size')
        }
        this.buf = this.buf.subarray(lineEnd + 2)
        if (size === 0) {
          this.chunkState = 'trailers'
          continue
        }
        this.chunkRemain = size
        this.chunkState = 'data'
      } else if (this.chunkState === 'data') {
        if (!this.buf.length) return
        const take = Math.min(this.buf.length, this.chunkRemain)
        out.push(this.buf.subarray(0, take))
        this.buf = this.buf.subarray(take)
        this.chunkRemain -= take
        if (this.chunkRemain === 0) {
          this.chunkState = 'data-crlf'
        }
      } else if (this.chunkState === 'data-crlf') {
        if (this.buf.length < 2) return
        if (this.buf[0] !== 0x0d || this.buf[1] !== 0x0a) {
          this.failed = true
          throw new HttpStreamParseError('malformed-response', 'Missing chunk CRLF')
        }
        this.buf = this.buf.subarray(2)
        this.chunkState = 'size'
      } else if (this.chunkState === 'trailers') {
        const sep = this.buf.indexOf('\r\n')
        if (sep < 0) return
        if (sep === 0) {
          this.buf = this.buf.subarray(2)
          this.complete = true
          return
        }
        this.buf = this.buf.subarray(sep + 2)
      }
    }
  }
}
