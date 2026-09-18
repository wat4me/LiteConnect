import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Readable } from 'stream'

/**
 * Unit-test queryStreamCapped without a live MySQL server.
 * Mock matches mysql2: Query.stream()._destroy only tears down the Readable
 * (resume + remove listeners) — it does NOT stop COM_QUERY protocol consumption.
 */

function makeRow(id: number) {
  return { id, name: `r${id}` }
}

/**
 * Realistic mysql2-like stream: destroy() stops delivering to consumer but
 * producer may continue (we track that). Connection must be destroyed, not released.
 */
function makeRawQuery(totalRows: number) {
  let emitted = 0
  let streamDestroyed = false
  let queryCalls = 0
  let protocolStillActive = false

  const rawDestroy = vi.fn(() => {
    protocolStillActive = false
  })

  const raw = {
    query: vi.fn((_opts: { sql: string; timeout?: number }) => {
      queryCalls++
      protocolStillActive = true
      return {
        stream: () => {
          const rows = Array.from({ length: totalRows }, (_, i) => makeRow(i + 1))
          let idx = 0
          const stream = new Readable({
            objectMode: true,
            highWaterMark: 1,
            read() {
              // mysql2 stream._destroy does NOT stop the connection from receiving
              // packets — but after we disconnect destroy, protocol ends.
              if (!protocolStillActive && streamDestroyed) return
              if (idx < rows.length) {
                emitted = idx + 1
                this.push(rows[idx++])
                return
              }
              this.push(null)
              protocolStillActive = false
            },
            destroy(err, cb) {
              // Match mysql2 Query.stream()._destroy: only local stream teardown
              streamDestroyed = true
              // Does NOT set protocolStillActive = false (that requires conn.destroy)
              cb(err)
            },
          })
          process.nextTick(() => {
            if (!streamDestroyed) stream.emit('fields', [{ name: 'id' }, { name: 'name' }])
          })
          return stream
        },
      }
    }),
    destroy: rawDestroy,
  }

  const promiseDestroy = vi.fn(() => {
    rawDestroy()
  })
  const release = vi.fn()

  const conn = {
    connection: raw,
    release,
    destroy: promiseDestroy,
    query: vi.fn(() => {
      throw new Error('promise query must not be used for streaming')
    }),
  }

  return {
    conn: conn as any,
    getQueryCalls: () => queryCalls,
    getEmitted: () => emitted,
    isStreamDestroyed: () => streamDestroyed,
    isProtocolActive: () => protocolStillActive,
    release,
    promiseDestroy,
    rawDestroy,
  }
}

describe('MySqlDriver.queryStreamCapped pool safety', () => {
  let MySqlDriver: new () => any

  beforeAll(async () => {
    ;({ MySqlDriver } = await import('./mysql'))
  })

  it('full read: one query, connectionReusable=true (safe to release)', async () => {
    const mock = makeRawQuery(5)
    const driver = new MySqlDriver()
    const out = await (driver as any).queryStreamCapped(
      mock.conn,
      'SELECT * FROM big',
      100,
      30_000,
      Date.now(),
      null,
    )
    expect(mock.getQueryCalls()).toBe(1)
    expect(out.connectionReusable).toBe(true)
    expect(out.result.rows).toHaveLength(5)
    expect(out.result.truncated).toBe(false)
    expect(mock.promiseDestroy).not.toHaveBeenCalled()
    expect(mock.release).not.toHaveBeenCalled() // release is caller's job when reusable
  })

  it('truncate: discards physical connection, not release; only one query; maxRows kept', async () => {
    const maxRows = 3
    const mock = makeRawQuery(50)
    const driver = new MySqlDriver()
    const out = await (driver as any).queryStreamCapped(
      mock.conn,
      'SELECT * FROM big',
      maxRows,
      30_000,
      Date.now(),
      null,
    )
    expect(mock.getQueryCalls()).toBe(1)
    expect(out.connectionReusable).toBe(false)
    expect(out.result.rows).toHaveLength(maxRows)
    expect(out.result.truncated).toBe(true)
    // Must destroy pool connection (not leave it busy for release)
    expect(mock.promiseDestroy).toHaveBeenCalled()
    expect(mock.release).not.toHaveBeenCalled()
    expect(mock.isStreamDestroyed()).toBe(true)
    expect(mock.getEmitted()).toBeLessThan(50)
  })

  it('query() finally releases only when connectionReusable; discards on truncate', async () => {
    const maxRows = 2
    const mock = makeRawQuery(100)
    const driver = new MySqlDriver()
    // Wire a fake session so public query() can be exercised is heavy;
    // assert the contract of the stream helper + finally pattern used in query().
    const out = await (driver as any).queryStreamCapped(
      mock.conn,
      'SELECT * FROM t',
      maxRows,
      30_000,
      Date.now(),
      null,
    )
    let connectionReusable = out.connectionReusable
    // Simulate query() finally:
    if (connectionReusable) {
      mock.conn.release()
    }
    // Truncate path: must NOT release
    expect(connectionReusable).toBe(false)
    expect(mock.release).not.toHaveBeenCalled()
    expect(mock.promiseDestroy).toHaveBeenCalled()
  })

  it('rejects when raw connection missing (no full-load fallback, no release)', async () => {
    const driver = new MySqlDriver()
    const conn = { release: vi.fn(), query: vi.fn(), destroy: vi.fn() } as any
    await expect(
      (driver as any).queryStreamCapped(conn, 'SELECT 1', 10, 5000, Date.now(), null),
    ).rejects.toThrow(/raw connection/i)
    expect(conn.query).not.toHaveBeenCalled()
    expect(conn.release).not.toHaveBeenCalled()
  })
})
