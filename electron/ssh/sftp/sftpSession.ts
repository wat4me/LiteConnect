import type { ClientChannel, SFTPWrapper } from 'ssh2'
import type { FileEntry, Session } from '../types'
import { shellQuote } from '../shellQuote'
import { t } from '../../i18n'

export class SftpSession {
  private sftpInitPromises = new Map<string, Promise<void>>()

  constructor(private getSession: (sessionId: string) => Session | undefined) {}

  clearInitPromise(sessionId: string) {
    this.sftpInitPromises.delete(sessionId)
  }

  async initSftp(sessionId: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(t('sftp.sessionNotFound'))
    if (session.sftp) return

    const existing = this.sftpInitPromises.get(sessionId)
    if (existing) return existing

    const promise = new Promise<void>((resolve, reject) => {
      session.client.sftp((err, sftp) => {
        this.sftpInitPromises.delete(sessionId)
        if (err) {
          reject(new Error(`SFTP init error: ${err.message}`))
        } else {
          session.sftp = sftp
          resolve()
        }
      })
    })
    this.sftpInitPromises.set(sessionId, promise)
    return promise
  }

  private classifyReaddirEntry(entry: {
    longname?: string
    attrs?: {
      mode?: number
      isDirectory?: () => boolean
      isSymbolicLink?: () => boolean
    }
  }): { isDirectory: boolean; isSymlink: boolean; permissions: string } {
    const longname = entry.longname || ''
    const firstChar = longname[0] || ''
    const attrs = entry.attrs
    const mode = attrs?.mode

    let isSymlink = false
    let isDirectory = false

    if (attrs && typeof attrs.isSymbolicLink === 'function' && typeof attrs.isDirectory === 'function') {
      isSymlink = attrs.isSymbolicLink()
      isDirectory = attrs.isDirectory()
    } else if (typeof mode === 'number') {
      const type = mode & 0o170000
      isSymlink = type === 0o120000 // S_IFLNK
      isDirectory = type === 0o040000 // S_IFDIR
    } else {
      isSymlink = firstChar === 'l'
      isDirectory = firstChar === 'd'
    }

    if (!isDirectory && !isSymlink) {
      if (firstChar === 'd') isDirectory = true
      else if (firstChar === 'l') isSymlink = true
    }

    const permissions =
      longname.length >= 10
        ? longname.substring(0, 10)
        : this.formatModeString(mode, isDirectory, isSymlink)

    return { isDirectory, isSymlink, permissions }
  }

  private formatModeString(
    mode: number | undefined,
    isDirectory: boolean,
    isSymlink: boolean,
  ): string {
    const typeChar = isDirectory ? 'd' : isSymlink ? 'l' : '-'
    if (typeof mode !== 'number') return `${typeChar}---------`
    const bits = mode & 0o777
    const rwx = (n: number) =>
      `${n & 4 ? 'r' : '-'}${n & 2 ? 'w' : '-'}${n & 1 ? 'x' : '-'}`
    return `${typeChar}${rwx((bits >> 6) & 7)}${rwx((bits >> 3) & 7)}${rwx(bits & 7)}`
  }

  private sftpStatIsDirectory(sftp: SFTPWrapper, remotePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err || !stats) {
          resolve(false)
          return
        }
        try {
          resolve(!!stats.isDirectory())
        } catch {
          resolve(false)
        }
      })
    })
  }

  async sftpReaddir(sessionId: string, remotePath: string): Promise<FileEntry[]> {
    const session = this.getSession(sessionId)
    if (!session?.sftp) throw new Error(t('sftp.notInitialized'))
    const sftp = session.sftp

    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          reject(new Error(`Readdir error: ${err.message}`))
          return
        }

        void (async () => {
          try {
            const entries: FileEntry[] = await Promise.all(
              list.map(async (entry) => {
                const classified = this.classifyReaddirEntry(entry)
                const entryPath =
                  remotePath === '/' ? `/${entry.filename}` : `${remotePath}/${entry.filename}`

                let isDirectory = classified.isDirectory
                if (classified.isSymlink && !isDirectory) {
                  isDirectory = await this.sftpStatIsDirectory(sftp, entryPath)
                }

                return {
                  name: entry.filename,
                  path: entryPath,
                  isDirectory,
                  isSymlink: classified.isSymlink,
                  size: entry.attrs.size || 0,
                  modifyTime: (entry.attrs.mtime || 0) * 1000,
                  permissions: classified.permissions,
                }
              }),
            )

            entries.sort((a, b) => {
              if (a.name === '..' || a.name === '.') return -1
              if (b.name === '..' || b.name === '.') return 1
              if (a.isDirectory && !b.isDirectory) return -1
              if (!a.isDirectory && b.isDirectory) return 1
              return a.name.localeCompare(b.name)
            })

            resolve(entries)
          } catch (mapErr: any) {
            reject(new Error(`Readdir error: ${mapErr?.message || mapErr}`))
          }
        })()
      })
    })
  }

  async sftpRealpath(sessionId: string, remotePath: string): Promise<string> {
    const session = this.getSession(sessionId)
    if (!session?.sftp) throw new Error(t('sftp.notInitialized'))

    return new Promise((resolve, reject) => {
      session.sftp!.realpath(remotePath, (err, absPath) => {
        if (err) {
          reject(new Error(`Realpath error: ${err.message}`))
        } else {
          resolve(absPath)
        }
      })
    })
  }

  sftpExists(sessionId: string, remotePath: string): Promise<boolean> {
    const session = this.getSession(sessionId)
    if (!session?.sftp) return Promise.reject(new Error(t('sftp.notInitialized')))
    return new Promise((resolve) => {
      session.sftp!.stat(remotePath, (err) => {
        resolve(!err)
      })
    })
  }

  async sftpExtractArchive(
    sessionId: string,
    remotePath: string,
    timeoutMs = 120000,
  ): Promise<string> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(t('sftp.sessionNotFound'))

    const fileName = remotePath.split('/').pop() || remotePath
    const lower = fileName.toLowerCase()
    let kind: 'targz' | 'tarbz2' | 'tarxz' | 'tar' | 'zip' | '7z' | 'gz' | null = null
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) kind = 'targz'
    else if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2') || lower.endsWith('.tbz')) kind = 'tarbz2'
    else if (lower.endsWith('.tar.xz') || lower.endsWith('.txz')) kind = 'tarxz'
    else if (lower.endsWith('.tar')) kind = 'tar'
    else if (lower.endsWith('.zip')) kind = 'zip'
    else if (lower.endsWith('.7z')) kind = '7z'
    else if (lower.endsWith('.gz')) kind = 'gz'
    if (!kind) throw new Error(t('sftp.unsupportedArchive'))

    const parent = remotePath.includes('/')
      ? remotePath.slice(0, remotePath.lastIndexOf('/')) || '/'
      : '.'
    const quotedFile = shellQuote(remotePath)
    const quotedDir = shellQuote(parent)

    let cmd: string
    switch (kind) {
      case 'targz':
        cmd = `cd -- ${quotedDir} && tar -xzf ${quotedFile}`
        break
      case 'tarbz2':
        cmd = `cd -- ${quotedDir} && tar -xjf ${quotedFile}`
        break
      case 'tarxz':
        cmd = `cd -- ${quotedDir} && tar -xJf ${quotedFile}`
        break
      case 'tar':
        cmd = `cd -- ${quotedDir} && tar -xf ${quotedFile}`
        break
      case 'zip':
        cmd = `cd -- ${quotedDir} && unzip -o ${quotedFile}`
        break
      case '7z':
        cmd = `cd -- ${quotedDir} && 7z x -y ${quotedFile}`
        break
      case 'gz':
        cmd = `cd -- ${quotedDir} && gunzip -k -f ${quotedFile}`
        break
    }

    return await this.sftpExec(sessionId, cmd, timeoutMs)
  }

  async sftpReadFile(sessionId: string, remotePath: string, maxBytes = 5 * 1024 * 1024): Promise<string> {
    const session = this.getSession(sessionId)
    if (!session?.sftp) throw new Error(t('sftp.notInitialized'))

    const stats = await this.sftpStat(sessionId, remotePath)
    if (typeof stats.size === 'number' && stats.size > maxBytes) {
      throw new Error(t('sftp.fileTooLargeWithSize', { size: stats.size, maxBytes }))
    }

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let total = 0
      const stream = session.sftp!.createReadStream(remotePath)
      let settled = false
      const finish = (err?: Error) => {
        if (settled) return
        settled = true
        if (err) {
          try {
            stream.destroy()
          } catch {}
          reject(err)
        } else {
          resolve(Buffer.concat(chunks).toString('utf-8'))
        }
      }
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length
        if (total > maxBytes) {
          finish(new Error(t('sftp.fileTooLarge', { maxBytes })))
          return
        }
        chunks.push(chunk)
      })
      stream.on('end', () => finish())
      stream.on('error', (err: Error) => finish(err))
    })
  }

  async sftpWriteFile(
    sessionId: string,
    remotePath: string,
    content: string,
    maxBytes = 5 * 1024 * 1024,
  ): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session?.sftp) throw new Error(t('sftp.notInitialized'))

    const buffer = Buffer.from(content, 'utf-8')
    if (buffer.length > maxBytes) {
      throw new Error(t('sftp.contentTooLarge', { size: buffer.length, maxBytes }))
    }

    return new Promise((resolve, reject) => {
      const stream = session.sftp!.createWriteStream(remotePath)
      let settled = false
      const finish = (err?: Error) => {
        if (settled) return
        settled = true
        if (err) reject(err)
        else resolve()
      }
      stream.on('close', () => finish())
      stream.on('error', (err: Error) => finish(err))
      stream.end(buffer)
    })
  }

  async sftpRename(sessionId: string, oldPath: string, newPath: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session?.sftp) throw new Error(t('sftp.notInitialized'))

    return new Promise((resolve, reject) => {
      session.sftp!.rename(oldPath, newPath, (err) => {
        if (err) reject(new Error(t('sftp.renameFailed', { error: err.message })))
        else resolve()
      })
    })
  }

  async sftpMkdir(sessionId: string, remotePath: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session?.sftp) throw new Error(t('sftp.notInitialized'))

    return new Promise((resolve, reject) => {
      session.sftp!.mkdir(remotePath, (err) => {
        if (err) reject(new Error(t('sftp.mkdirFailed', { error: err.message })))
        else resolve()
      })
    })
  }

  async sftpUnlink(sessionId: string, remotePath: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session?.sftp) throw new Error(t('sftp.notInitialized'))

    return new Promise((resolve, reject) => {
      session.sftp!.unlink(remotePath, (err) => {
        if (err) reject(new Error(t('sftp.unlinkFailed', { error: err.message })))
        else resolve()
      })
    })
  }

  async sftpRmdir(sessionId: string, remotePath: string): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session?.sftp) throw new Error(t('sftp.notInitialized'))

    return new Promise((resolve, reject) => {
      session.sftp!.rmdir(remotePath, (err) => {
        if (err) reject(new Error(t('sftp.rmdirFailed', { error: err.message })))
        else resolve()
      })
    })
  }

  async sftpDelete(sessionId: string, remotePath: string, isDirectory: boolean): Promise<void> {
    if (!remotePath || remotePath === '/') {
      throw new Error(t('sftp.cannotDeleteRoot'))
    }
    if (isDirectory) {
      try {
        await this.sftpRmdir(sessionId, remotePath)
        return
      } catch {
        // non-empty or permission — fall through to recursive rm
      }
      const escaped = shellQuote(remotePath)
      await this.sftpExec(sessionId, `rm -rf -- ${escaped}`, 60000)
      return
    }
    await this.sftpUnlink(sessionId, remotePath)
  }

  async sftpChmod(sessionId: string, remotePath: string, mode: string, recursive = false): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(t('sftp.sessionNotFound'))

    const flag = recursive ? '-R ' : ''
    const escapedPath = shellQuote(remotePath)
    return new Promise((resolve, reject) => {
      session.client.exec(`chmod ${flag}${mode} ${escapedPath}`, (err, stream) => {
        if (err) {
          reject(new Error(`chmod error: ${err.message}`))
          return
        }
        let stderr = ''
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString()
        })
        stream.on('close', () => {
          if (stderr.trim()) reject(new Error(stderr.trim()))
          else resolve()
        })
        stream.on('error', (e: Error) => reject(e))
      })
    })
  }

  async sftpChown(
    sessionId: string,
    remotePath: string,
    owner: string,
    group?: string,
    recursive = false,
  ): Promise<void> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(t('sftp.sessionNotFound'))

    const spec = group ? `${shellQuote(owner)}:${shellQuote(group)}` : shellQuote(owner)
    const flag = recursive ? '-R ' : ''
    const escapedPath = shellQuote(remotePath)
    return new Promise((resolve, reject) => {
      session.client.exec(`chown ${flag}${spec} ${escapedPath}`, (err, stream) => {
        if (err) {
          reject(new Error(`chown error: ${err.message}`))
          return
        }
        let stderr = ''
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString()
        })
        stream.on('close', () => {
          if (stderr.trim()) reject(new Error(stderr.trim()))
          else resolve()
        })
        stream.on('error', (e: Error) => reject(e))
      })
    })
  }

  async sftpStat(sessionId: string, remotePath: string): Promise<{
    mode: string
    size: number
    uid: number
    gid: number
    atime: number
    mtime: number
    owner: string
    group: string
  }> {
    const session = this.getSession(sessionId)
    if (!session?.sftp) throw new Error(t('sftp.notInitialized'))

    return new Promise((resolve, reject) => {
      session.sftp!.stat(remotePath, (err, stats) => {
        if (err) {
          reject(new Error(`stat error: ${err.message}`))
          return
        }
        resolve({
          mode: (stats.mode & 0o777).toString(8).padStart(3, '0'),
          size: stats.size,
          uid: stats.uid,
          gid: stats.gid,
          atime: stats.atime,
          mtime: stats.mtime,
          owner: String(stats.uid),
          group: String(stats.gid),
        })
      })
    })
  }

  async sftpExec(sessionId: string, command: string, timeoutMs = 10000): Promise<string> {
    const session = this.getSession(sessionId)
    if (!session) throw new Error(t('sftp.sessionNotFound'))

    return new Promise((resolve, reject) => {
      let settled = false
      let execStream: ClientChannel | null = null
      const finish = (err?: Error, output = '') => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (err) {
          reject(err)
        } else {
          resolve(output.trim())
        }
      }
      const timer = setTimeout(() => {
        try {
          execStream?.close()
        } catch {}
        finish(new Error(`Exec timeout after ${timeoutMs}ms`))
      }, timeoutMs)

      session.client.exec(command, (err, stream) => {
        if (err) {
          finish(new Error(`Exec error: ${err.message}`))
          return
        }

        execStream = stream
        let output = ''
        stream.on('data', (data: Buffer) => {
          if (settled) return
          output += data.toString('utf-8')
        })
        stream.stderr.on('data', (data: Buffer) => {
          if (settled) return
          output += data.toString('utf-8')
        })
        stream.on('close', () => {
          finish(undefined, output)
        })
        stream.on('error', (streamErr: Error) => {
          finish(streamErr)
        })
      })
    })
  }

  measureLatency(sessionId: string): Promise<number> {
    const session = this.getSession(sessionId)
    if (!session) return Promise.reject(new Error(t('sftp.sessionNotFound')))

    const start = Date.now()
    return new Promise((resolve, reject) => {
      let resolved = false
      let execStream: ClientChannel | null = null
      const finish = (err?: Error) => {
        if (resolved) return
        resolved = true
        clearTimeout(timeout)
        if (err) {
          reject(err)
        } else {
          resolve(Date.now() - start)
        }
      }
      const timeout = setTimeout(() => {
        try {
          execStream?.close()
        } catch {}
        finish(new Error('Latency measurement timeout'))
      }, 5000)

      session.client.exec('true', (err, stream) => {
        if (err) {
          finish(err)
          return
        }
        execStream = stream
        stream.on('data', () => finish())
        stream.stderr.on('data', () => finish())
        stream.on('close', () => finish())
        stream.on('error', (streamErr: Error) => finish(streamErr))
      })
    })
  }
}
