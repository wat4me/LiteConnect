import type { Client } from 'ssh2'
import * as net from 'net'
import type { Connection, SSHCallbacks } from './types'
import { t } from '../i18n'
import type { LocalForwardServer } from './localForwards'

function readExact(socket: net.Socket, n: number, timeoutMs = 8000): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let got = 0
    const onData = (buf: Buffer) => {
      chunks.push(buf)
      got += buf.length
      if (got >= n) {
        cleanup()
        const all = Buffer.concat(chunks)
        const extra = all.subarray(n)
        if (extra.length) socket.unshift(extra)
        resolve(all.subarray(0, n))
      }
    }
    const onErr = (err: Error) => {
      cleanup()
      reject(err)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('SOCKS handshake timeout'))
    }, timeoutMs)
    const cleanup = () => {
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onErr)
      socket.off('close', onClose)
    }
    const onClose = () => {
      cleanup()
      reject(new Error('SOCKS socket closed'))
    }
    socket.on('data', onData)
    socket.on('error', onErr)
    socket.on('close', onClose)
  })
}

async function handleSocks5(socket: net.Socket, client: Client): Promise<void> {
  const greetHead = await readExact(socket, 2)
  if (greetHead[0] !== 0x05) throw new Error('Unsupported SOCKS version')
  const nMethods = greetHead[1]
  if (nMethods > 0) await readExact(socket, nMethods)
  socket.write(Buffer.from([0x05, 0x00]))

  const reqHead = await readExact(socket, 4)
  if (reqHead[0] !== 0x05 || reqHead[1] !== 0x01) {
    socket.write(Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
    throw new Error('Only SOCKS5 CONNECT is supported')
  }
  const atyp = reqHead[3]
  let host = ''
  if (atyp === 0x01) {
    const addr = await readExact(socket, 4)
    host = `${addr[0]}.${addr[1]}.${addr[2]}.${addr[3]}`
  } else if (atyp === 0x03) {
    const lenBuf = await readExact(socket, 1)
    const name = await readExact(socket, lenBuf[0])
    host = name.toString('utf8')
  } else if (atyp === 0x04) {
    const addr = await readExact(socket, 16)
    const parts: string[] = []
    for (let i = 0; i < 16; i += 2) parts.push(addr.readUInt16BE(i).toString(16))
    host = parts.join(':')
  } else {
    throw new Error('Unsupported SOCKS address type')
  }
  const portBuf = await readExact(socket, 2)
  const port = portBuf.readUInt16BE(0)

  await new Promise<void>((resolve, reject) => {
    client.forwardOut('127.0.0.1', 0, host, port, (err, stream) => {
      if (err || !stream) {
        socket.write(Buffer.from([0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
        reject(err || new Error('forwardOut failed'))
        return
      }
      socket.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]))
      socket.pipe(stream)
      stream.pipe(socket)
      socket.on('error', () => stream.destroy())
      stream.on('error', () => socket.destroy())
      resolve()
    })
  })
}

export function setupDynamicForwards(
  client: Client,
  connection: Connection,
  sessionId: string,
  callbacks: SSHCallbacks,
): LocalForwardServer[] {
  const servers: LocalForwardServer[] = []
  const list = connection.dynamicForwards || []
  for (const fwd of list) {
    if (!fwd || !fwd.localPort) continue
    const sockets = new Set<net.Socket>()
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      void handleSocks5(socket, client).catch(() => {
        try {
          socket.destroy()
        } catch {}
      })
    }) as LocalForwardServer
    server.__liteConnectSockets = sockets
    servers.push(server)
    server.once('error', (err) => {
      callbacks.onData(
        sessionId,
        `\r\n\x1b[33m[LiteConnect] ${t('ssh.dynamicForwardListenFailed', {
          localPort: fwd.localPort,
          error: err.message,
        })}\x1b[0m\r\n`,
      )
    })
    try {
      server.listen(fwd.localPort, '127.0.0.1', () => {
        callbacks.onData(
          sessionId,
          `\r\n\x1b[32m[LiteConnect] ${t('ssh.dynamicForwardOk', {
            localPort: fwd.localPort,
          })}\x1b[0m\r\n`,
        )
      })
    } catch (err: any) {
      callbacks.onData(
        sessionId,
        `\r\n\x1b[33m[LiteConnect] ${t('ssh.dynamicForwardListenFailed', {
          localPort: fwd.localPort,
          error: err?.message || String(err),
        })}\x1b[0m\r\n`,
      )
    }
  }
  return servers
}
