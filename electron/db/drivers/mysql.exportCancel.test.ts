import { describe, expect, it } from 'vitest'
import { Readable } from 'stream'
import { MySqlDriver } from './mysql'

/**
 * Export cancel must destroy physical connection (mysql2 stream.destroy does not stop protocol).
 */
describe('MySqlDriver.exportTableStream cancel', () => {
  it('cancel destroys connection and does not release', async () => {
    const driver = new MySqlDriver()
    const released: string[] = []
    const destroyed: string[] = []

    let pushTimer: ReturnType<typeof setTimeout> | null = null

    const stream = new Readable({
      objectMode: true,
      read() {},
    })

    const raw = {
      query: () => ({
        stream: () => stream,
      }),
    }

    const conn = {
      connection: raw,
      release: () => {
        released.push('release')
      },
      destroy: () => {
        destroyed.push('destroy')
        try {
          stream.destroy()
        } catch {}
      },
    }

    const pool = {
      getConnection: async () => conn,
      end: async () => {},
      query: async () => [[{}], []],
    }

    ;(driver as any).sessions.set('s1', {
      id: 's1',
      connectionId: 'c1',
      connectionName: 't',
      host: '127.0.0.1',
      port: 3306,
      username: 'u',
      database: 'db',
      serverVersion: '8',
      password: 'x',
      ssl: false,
      pool,
    })

    let cancelled = false
    const exportP = driver.exportTableStream('s1', 'db', 'users', {
      maxRows: 1000,
      format: 'csv',
      isCancelled: () => cancelled,
      onColumns: () => {},
      onRow: async () => {
        cancelled = true
      },
    })

    // Drive the stream asynchronously after listeners attach
    pushTimer = setTimeout(() => {
      stream.emit('fields', [{ name: 'id' }])
      stream.push({ id: 1 })
      // Keep protocol "active" until destroy
      pushTimer = setTimeout(() => {
        if (!stream.destroyed) stream.push({ id: 2 })
      }, 30)
    }, 0)

    await expect(exportP).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' })
    if (pushTimer) clearTimeout(pushTimer)
    expect(destroyed.length).toBeGreaterThanOrEqual(1)
    expect(released).toEqual([])
  })
})
