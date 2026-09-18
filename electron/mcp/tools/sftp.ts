import { mkdir, stat } from 'fs/promises'
import { dirname } from 'path'
import {
  MCP_EDIT_MAX_FILE_BYTES,
  MCP_MAX_DIR_ENTRIES,
  MCP_MAX_READ_FILE_BYTES,
  MCP_MAX_TRANSFER_BYTES,
  MCP_MAX_WRITE_FILE_BYTES,
  MCP_READ_MAX_BYTES,
  MCP_READ_MAX_LINE_CHARS,
  MCP_TAIL_MAX_BYTES,
} from '../../../shared/mcp/limits'
import { applyExactEdit } from '../../../shared/exactEdit'
import type { SshMcpDirEntry, SshMcpToolResult } from '../../../shared/mcp/types'
import { clampLength, clampLines, clampOffset, parseEncoding, requireLocalPath, requireRemotePath } from '../args'
import type { McpRuntimeHost } from '../runtimeHost'
import { clampReadLimit, clampReadStartLine, createLineCollector, prefixLineNumbers, READ_CHUNK_BYTES } from './fileWindow'

function wantsByteWindow(input: Record<string, unknown>): boolean {
  if (parseEncoding(input.encoding) === 'base64') return true
  const hasByte = input.offset != null || input.length != null
  const hasLine = input.startLine != null || input.limit != null
  return hasByte && !hasLine
}

export async function readFileTool(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const session = host.requireSession(input.sessionId)
  const path = requireRemotePath(input.path)
  const encoding = parseEncoding(input.encoding)
  if (wantsByteWindow(input)) {
    const offset = clampOffset(input.offset)
    const length = clampLength(input.length, MCP_MAX_READ_FILE_BYTES)
    const ranged = await host.withSftp(session.sessionId, session.generation, () =>
      host.ssh.sftpReadFileRange(session.sessionId, path, offset, length),
    )
    host.touch(session.sessionId)
    const content = encoding === 'base64' ? ranged.buffer.toString('base64') : ranged.buffer.toString('utf8')
    return host.ok({
      path,
      content,
      encoding,
      bytes: ranged.buffer.length,
      size: ranged.size,
      offset,
      eof: ranged.eof,
      nextOffset: offset + ranged.buffer.length,
    })
  }

  const startLine = clampReadStartLine(input.startLine)
  const limit = clampReadLimit(input.limit)
  const collector = createLineCollector({
    startLine,
    limit,
    maxBytes: MCP_READ_MAX_BYTES,
    maxLineChars: MCP_READ_MAX_LINE_CHARS,
  })
  let bytePos = 0
  let size = 0
  let eof = false
  let binary = false

  await host.withSftp(session.sessionId, session.generation, async () => {
    while (!collector.stopped) {
      const ranged = await host.ssh.sftpReadFileRange(session.sessionId, path, bytePos, READ_CHUNK_BYTES)
      size = ranged.size
      if (bytePos === 0 && ranged.buffer.includes(0)) {
        binary = true
        return
      }
      collector.push(ranged.buffer.toString('utf8'), ranged.eof)
      bytePos += ranged.buffer.length
      eof = ranged.eof
      if (ranged.eof || ranged.buffer.length === 0) break
    }
  })

  if (binary) {
    return host.error(
      'INVALID_ARGUMENTS',
      'File looks binary. Re-call read_file with encoding=base64 and offset/length (max 50 KiB).',
    )
  }

  const window = collector.result()
  host.touch(session.sessionId)
  const truncated = window.hitByteCap || window.hitLineCap || window.clippedLine || !eof
  // Line numbers are the locator an agent edits against, so they are on by
  // default. Callers that need raw text (approval-card diffing) pass false.
  const lineNumbers = input.lineNumbers !== false
  return host.ok({
    path,
    content: lineNumbers ? prefixLineNumbers(window.lines, window.startLine) : window.lines.join('\n'),
    lineNumbers,
    encoding: 'utf8',
    startLine: window.startLine,
    lineCount: window.lines.length,
    nextLine: window.nextLine,
    bytes: window.bytes,
    size,
    eof: eof && !window.hitByteCap,
    truncated,
  })
}

/**
 * Read an entire text file, refusing anything we could not write back or that
 * is not text. Returns a discriminated result so the caller maps it to a tool
 * error without throwing.
 */
async function readWholeTextFile(
  host: McpRuntimeHost,
  session: { sessionId: string; generation: number },
  path: string,
): Promise<{ ok: true; text: string } | { ok: false; code: string; message: string }> {
  const chunks: Buffer[] = []
  let bytePos = 0
  let tooLarge = false
  let binary = false

  await host.withSftp(session.sessionId, session.generation, async () => {
    for (;;) {
      const ranged = await host.ssh.sftpReadFileRange(session.sessionId, path, bytePos, READ_CHUNK_BYTES)
      // Fail fast on size before pulling the whole thing over the wire.
      if (bytePos === 0 && ranged.size > MCP_EDIT_MAX_FILE_BYTES) {
        tooLarge = true
        return
      }
      if (bytePos === 0 && ranged.buffer.includes(0)) {
        binary = true
        return
      }
      chunks.push(ranged.buffer)
      bytePos += ranged.buffer.length
      if (ranged.eof || ranged.buffer.length === 0) break
    }
  })

  if (tooLarge) {
    return {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message:
        `File is larger than the ${MCP_EDIT_MAX_FILE_BYTES}-byte edit limit. ` +
        'Use exec with a text tool (for example sed -i) for this file, or edit a smaller one.',
    }
  }
  if (binary) {
    return {
      ok: false,
      code: 'NOT_A_TEXT_FILE',
      message: 'File is binary; edit_file only handles text. Use exec or upload_file instead.',
    }
  }
  return { ok: true, text: Buffer.concat(chunks).toString('utf8') }
}

/**
 * Exact-string edit. Applied against the file content read at edit time, so a
 * stale or hallucinated oldString simply fails to match instead of overwriting
 * whatever is on disk now.
 */
export async function editFileTool(host: McpRuntimeHost, input: Record<string, unknown>): Promise<SshMcpToolResult> {
  const session = host.requireSession(input.sessionId)
  const path = requireRemotePath(input.path)
  if (typeof input.oldString !== 'string') {
    return host.error('INVALID_ARGUMENTS', 'oldString is required')
  }
  if (typeof input.newString !== 'string') {
    return host.error('INVALID_ARGUMENTS', 'newString is required')
  }
  const replaceAll = input.replaceAll === true

  const current = await readWholeTextFile(host, session, path)
  if (!current.ok) return host.error(current.code, current.message)

  const edit = applyExactEdit(current.text, input.oldString, input.newString, replaceAll)
  if (!edit.ok) {
    return host.error(edit.code, `${edit.message} ${edit.hint}`.trim())
  }

  const buffer = Buffer.from(edit.text, 'utf8')
  if (buffer.length > MCP_MAX_WRITE_FILE_BYTES) {
    return host.error(
      'FILE_TOO_LARGE',
      `Edit would grow the file past the ${MCP_MAX_WRITE_FILE_BYTES}-byte write limit.`,
    )
  }

  await host.withSftp(session.sessionId, session.generation, () =>
    host.ssh.sftpWriteBuffer(session.sessionId, path, buffer),
  )
  host.touch(session.sessionId)
  return host.ok({ path, replaced: edit.replaced, bytes: buffer.length, encoding: 'utf8' })
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
