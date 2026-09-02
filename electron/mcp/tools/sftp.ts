import { mkdir, stat } from 'fs/promises'
import { dirname } from 'path'
import {
  MCP_MAX_DIR_ENTRIES,
  MCP_MAX_READ_FILE_BYTES,
  MCP_MAX_TRANSFER_BYTES,
  MCP_MAX_WRITE_FILE_BYTES,
  MCP_TAIL_MAX_BYTES,
} from '../../../shared/mcp/limits'
import type { SshMcpDirEntry, SshMcpToolResult } from '../../../shared/mcp/types'
import { clampLength, clampLines, clampOffset, parseEncoding, requireLocalPath, requireRemotePath } from '../args'
import type { McpRuntimeHost } from '../runtimeHost'

export async function readFileTool(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const session = host.requireSession(input.sessionId)
  const path = requireRemotePath(input.path)
  const offset = clampOffset(input.offset)
  const length = clampLength(input.length, MCP_MAX_READ_FILE_BYTES)
  const encoding = parseEncoding(input.encoding)
  const ranged = await host.withSftp(session.sessionId, session.generation, () =>
    host.ssh.sftpReadFileRange(session.sessionId, path, offset, length),
  )
  host.touch(session.sessionId)
  const content = encoding === 'base64' ? ranged.buffer.toString('base64') : ranged.buffer.toString('utf8')
  const nextOffset = offset + ranged.buffer.length
  return host.ok({
    path,
    content,
    encoding,
    bytes: ranged.buffer.length,
    size: ranged.size,
    offset,
    eof: ranged.eof,
    nextOffset,
  })
}

export async function writeFileTool(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const session = host.requireSession(input.sessionId)
  const path = requireRemotePath(input.path)
  if (typeof input.content !== 'string') {
    return host.error('INVALID_ARGUMENTS', 'content is required')
  }
  const encoding = parseEncoding(input.encoding)
  let buffer: Buffer
  try {
    buffer = encoding === 'base64' ? Buffer.from(input.content, 'base64') : Buffer.from(input.content, 'utf8')
  } catch {
    return host.error('INVALID_ARGUMENTS', 'content is not valid for the chosen encoding')
  }
  if (buffer.length > MCP_MAX_WRITE_FILE_BYTES) {
    return host.error(
      'FILE_TOO_LARGE',
      `Write is limited to ${MCP_MAX_WRITE_FILE_BYTES} bytes per call; use upload_file for larger files`,
    )
  }
  await host.withSftp(session.sessionId, session.generation, () =>
    host.ssh.sftpWriteBuffer(session.sessionId, path, buffer),
  )
  host.touch(session.sessionId)
  return host.ok({ path, bytes: buffer.length, encoding })
}

export async function downloadFile(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const session = host.requireSession(input.sessionId)
  const remotePath = requireRemotePath(input.remotePath)
  const localPath = requireLocalPath(input.localPath)
  const st = await host.withSftp(session.sessionId, session.generation, () =>
    host.ssh.sftpStat(session.sessionId, remotePath),
  )
  if (st.size > MCP_MAX_TRANSFER_BYTES) {
    return host.error('FILE_TOO_LARGE', `Remote file is ${st.size} bytes; max download is ${MCP_MAX_TRANSFER_BYTES}`)
  }
  await mkdir(dirname(localPath), { recursive: true })
  await host.withSftp(session.sessionId, session.generation, () =>
    host.ssh.sftpDownload(session.sessionId, remotePath, localPath),
  )
  host.touch(session.sessionId)
  return host.ok({ remotePath, localPath, bytes: st.size })
}

export async function uploadFile(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const session = host.requireSession(input.sessionId)
  const remotePath = requireRemotePath(input.remotePath)
  const localPath = requireLocalPath(input.localPath)
  let size = 0
  try {
    const st = await stat(localPath)
    if (!st.isFile()) return host.error('INVALID_PATH', 'localPath must be a regular file')
    size = st.size
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return host.error('INVALID_PATH', message)
  }
  if (size > MCP_MAX_TRANSFER_BYTES) {
    return host.error('FILE_TOO_LARGE', `Local file is ${size} bytes; max upload is ${MCP_MAX_TRANSFER_BYTES}`)
  }
  await host.withSftp(session.sessionId, session.generation, () =>
    host.ssh.sftpUpload(session.sessionId, localPath, remotePath),
  )
  host.touch(session.sessionId)
  return host.ok({ localPath, remotePath, bytes: size })
}

export async function listDir(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const session = host.requireSession(input.sessionId)
  const path = requireRemotePath(input.path)
  const entries = await host.withSftp(session.sessionId, session.generation, () =>
    host.ssh.sftpReaddir(session.sessionId, path),
  )
  host.touch(session.sessionId)
  const truncated = entries.length > MCP_MAX_DIR_ENTRIES
  const sliced: SshMcpDirEntry[] = entries.slice(0, MCP_MAX_DIR_ENTRIES).map((e) => ({
    name: e.name,
    path: e.path,
    isDirectory: e.isDirectory,
    isSymlink: e.isSymlink,
    size: e.size,
    modifyTime: e.modifyTime,
    permissions: e.permissions,
  }))
  return host.ok({ path, entries: sliced, truncated, total: entries.length })
}

export async function statPath(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const session = host.requireSession(input.sessionId)
  const path = requireRemotePath(input.path)
  const statResult = await host.withSftp(session.sessionId, session.generation, () =>
    host.ssh.sftpStat(session.sessionId, path),
  )
  host.touch(session.sessionId)
  return host.ok({
    path,
    mode: statResult.mode,
    size: statResult.size,
    uid: statResult.uid,
    gid: statResult.gid,
    atime: statResult.atime,
    mtime: statResult.mtime,
  })
}

export async function tailFile(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const session = host.requireSession(input.sessionId)
  const path = requireRemotePath(input.path)
  const lines = clampLines(input.lines)
  const st = await host.withSftp(session.sessionId, session.generation, () =>
    host.ssh.sftpStat(session.sessionId, path),
  )
  if (st.size <= 0) {
    host.touch(session.sessionId)
    return host.ok({ path, lines: [], lineCount: 0, size: 0, truncated: false })
  }
  const length = Math.min(st.size, MCP_TAIL_MAX_BYTES)
  const offset = Math.max(0, st.size - length)
  const ranged = await host.withSftp(session.sessionId, session.generation, () =>
    host.ssh.sftpReadFileRange(session.sessionId, path, offset, Math.max(1, length) || 1),
  )
  host.touch(session.sessionId)
  const text = ranged.buffer.toString('utf8')
  const all = text.split(/\r?\n/)
  if (all.length && all[all.length - 1] === '') all.pop()
  const sliced = all.slice(-lines)
  return host.ok({
    path,
    lines: sliced,
    lineCount: sliced.length,
    size: st.size,
    truncated: st.size > MCP_TAIL_MAX_BYTES || all.length > lines,
  })
}
