import { createServer, type Socket } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { diagnoseSshConnection } from './diagnosis'

const sockets = new Set<Socket>()

afterEach(() => {
  for (const socket of sockets) socket.destroy()
  sockets.clear()
})

describe('diagnoseSshConnection timeout handling', () => {
  it('returns a wrapped failure when TCP connects but the SSH handshake stalls', async () => {
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      // Intentionally accept the connection without sending an SSH banner.
    })

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })

    try {
      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('Missing test server address')

      const result = await diagnoseSshConnection(
        {
          host: '127.0.0.1',
          port: address.port,
          username: 'test',
          password: 'test',
        },
        undefined,
        500,
      )

      expect(result).toMatchObject({
        ok: false,
        stage: 'ssh_handshake',
      })
      expect(result.error).toMatch(/timeout|Timed out while waiting for handshake/i)

      // Allow ssh2's own readyTimeout callback to run after outer cleanup. Before
      // the guard this late `error` event became an uncaught main-process error.
      await new Promise((resolve) => setTimeout(resolve, 600))
    } finally {
      for (const socket of sockets) socket.destroy()
      sockets.clear()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
