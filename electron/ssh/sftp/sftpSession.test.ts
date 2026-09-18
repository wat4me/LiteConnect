import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { SftpSession } from './sftpSession'

function createSessionForExec(run: (stream: EventEmitter & { stderr: EventEmitter }) => void): Session {
  const client = {
    exec: vi.fn((_command: string, callback: (err: Error | undefined, stream: any) => void) => {
      const stream = new EventEmitter() as EventEmitter & { stderr: EventEmitter; close: () => void }
      stream.stderr = new EventEmitter()
      stream.close = vi.fn()
      callback(undefined, stream)
      setImmediate(() => run(stream))
    }),
  }
  return {
    id: 'sess-1',
    client: client as any,
    stream: {} as any,
    connectionId: 'c1',
    connectionName: 'test',
  }
}

function createSessionWithSftp(sftp: Record<string, unknown>): Session {
  return {
    id: 'sess-1',
    client: {} as any,
    stream: {} as any,
    connectionId: 'c1',
    connectionName: 'test',
    sftp: sftp as any,
  }
}

describe('SftpSession remote exec status', () => {
  it('rejects a non-zero remote exit status with stderr', async () => {
    const session = createSessionForExec((stream) => {
      stream.stderr.emit('data', Buffer.from('permission denied'))
      stream.emit('close', 1, null)
    })
    const sftp = new SftpSession(() => session)

    await expect(sftp.sftpExec('sess-1', 'false')).rejects.toThrow('permission denied')
  })

  it('resolves output when the remote command exits successfully', async () => {
    const session = createSessionForExec((stream) => {
      stream.emit('data', Buffer.from('ok\n'))
      stream.emit('close', 0, null)
    })
    const sftp = new SftpSession(() => session)

    await expect(sftp.sftpExec('sess-1', 'true')).resolves.toBe('ok')
  })

  it('keeps stderr noise (e.g. from .bashrc) out of the resolved stdout', async () => {
    const session = createSessionForExec((stream) => {
      stream.stderr.emit('data', Buffer.from("stty: 'standard input': Inappropriate ioctl for device\n"))
      stream.emit('data', Buffer.from('/home/alice'))
      stream.emit('close', 0, null)
    })
    const sftp = new SftpSession(() => session)

    await expect(sftp.sftpExec('sess-1', 'printf "%s" "$HOME"')).resolves.toBe('/home/alice')
  })

  it('takes the exit code from the exit event when close carries none', async () => {
    const session = createSessionForExec((stream) => {
      stream.emit('exit', 2)
      stream.emit('close')
    })
    const sftp = new SftpSession(() => session)

    await expect(sftp.sftpExec('sess-1', 'false')).rejects.toThrow('exited with code 2')
  })
})

describe('SftpSession archive extraction', () => {
  it('treats unzip exit status 1 as a warning, not a failure', async () => {
    const session = createSessionForExec((stream) => {
      stream.emit('data', Buffer.from('inflating: a.txt\n'))
      stream.stderr.emit('data', Buffer.from('warning: backslashes as path separators'))
      stream.emit('close', 1, null)
    })
    const sftp = new SftpSession(() => session)

    await expect(sftp.sftpExtractArchive('sess-1', '/tmp/a.zip')).resolves.toContain('warning')
  })

  it('still fails on a fatal unzip exit status', async () => {
    const session = createSessionForExec((stream) => {
      stream.stderr.emit('data', Buffer.from('End-of-central-directory signature not found'))
      stream.emit('close', 9, null)
    })
    const sftp = new SftpSession(() => session)

    await expect(sftp.sftpExtractArchive('sess-1', '/tmp/a.zip')).rejects.toThrow('End-of-central-directory')
  })

  it('does not tolerate exit status 1 for tar', async () => {
    const session = createSessionForExec((stream) => {
      stream.stderr.emit('data', Buffer.from('tar: Error is not recoverable'))
      stream.emit('close', 1, null)
    })
    const sftp = new SftpSession(() => session)

    await expect(sftp.sftpExtractArchive('sess-1', '/tmp/a.tar.gz')).rejects.toThrow('not recoverable')
  })

  it('treats gzip exit status 2 as a warning but 1 as a failure', async () => {
    const warned = createSessionForExec((stream) => {
      stream.stderr.emit('data', Buffer.from('gzip: a.gz: decompression OK, trailing garbage ignored'))
      stream.emit('close', 2, null)
    })
    await expect(new SftpSession(() => warned).sftpExtractArchive('sess-1', '/tmp/a.gz')).resolves.toContain(
      'trailing garbage',
    )

    const failed = createSessionForExec((stream) => {
      stream.stderr.emit('data', Buffer.from('gzip: a.gz: not in gzip format'))
      stream.emit('close', 1, null)
    })
    await expect(new SftpSession(() => failed).sftpExtractArchive('sess-1', '/tmp/a.gz')).rejects.toThrow(
      'not in gzip format',
    )
  })
})

describe('SftpSession channel lifecycle', () => {
  it('forgets a closed SFTP channel so the next init reopens it', async () => {
    const channels: EventEmitter[] = []
    const client = {
      sftp: vi.fn((cb: (err: Error | undefined, sftp: any) => void) => {
        const channel = new EventEmitter()
        channels.push(channel)
        cb(undefined, channel)
      }),
    }
    const session: Session = {
      id: 'sess-1',
      client: client as any,
      stream: {} as any,
      connectionId: 'c1',
      connectionName: 'test',
    }
    const sftp = new SftpSession(() => session)

    await sftp.initSftp('sess-1')
    await sftp.initSftp('sess-1')
    expect(client.sftp).toHaveBeenCalledTimes(1)
    expect(session.sftp).toBe(channels[0])

    channels[0].emit('close')
    expect(session.sftp).toBeUndefined()

    await sftp.initSftp('sess-1')
    expect(client.sftp).toHaveBeenCalledTimes(2)
    expect(session.sftp).toBe(channels[1])
  })
})

describe('SftpSession stat and editor reads', () => {
  it('reports whether a path is a directory', async () => {
    const session = createSessionWithSftp({
      stat: (_path: string, cb: (err: Error | null, stats: any) => void) =>
        cb(null, { mode: 0o40755, size: 4096, uid: 1000, gid: 1000, atime: 1, mtime: 2, isDirectory: () => true }),
    })
    const sftp = new SftpSession(() => session)

    await expect(sftp.sftpStat('sess-1', '/tmp')).resolves.toMatchObject({ mode: '755', isDirectory: true })
  })

  function readableOf(chunks: Buffer[]) {
    const stream = new EventEmitter() as EventEmitter & { destroy: () => void }
    stream.destroy = vi.fn()
    setImmediate(() => {
      for (const chunk of chunks) stream.emit('data', chunk)
      stream.emit('end')
    })
    return stream
  }

  it('refuses non-UTF-8 content instead of returning replacement characters', async () => {
    const session = createSessionWithSftp({
      stat: (_path: string, cb: (err: Error | null, stats: any) => void) => cb(null, { size: 2 }),
      createReadStream: () => readableOf([Buffer.from([0xc4, 0xe3])]),
    })
    const sftp = new SftpSession(() => session)

    await expect(sftp.sftpReadFile('sess-1', '/tmp/gbk.txt')).rejects.toThrow('UTF-8')
  })

  it('reads UTF-8 text split across chunks', async () => {
    const bytes = Buffer.from('你好\r\nworld', 'utf-8')
    const session = createSessionWithSftp({
      stat: (_path: string, cb: (err: Error | null, stats: any) => void) => cb(null, { size: bytes.length }),
      createReadStream: () => readableOf([bytes.subarray(0, 4), bytes.subarray(4)]),
    })
    const sftp = new SftpSession(() => session)

    await expect(sftp.sftpReadFile('sess-1', '/tmp/a.txt')).resolves.toBe('你好\r\nworld')
  })
})
