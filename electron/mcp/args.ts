import {
  MCP_DEFAULT_FANOUT_CONCURRENCY,
  MCP_DEFAULT_JOB_TIMEOUT_MS,
  MCP_DEFAULT_TIMEOUT_MS,
  MCP_MAX_FANOUT_CONCURRENCY,
  MCP_MAX_JOB_TIMEOUT_MS,
  MCP_MAX_STDIN_CHARS,
  MCP_MAX_TIMEOUT_MS,
  MCP_MIN_TIMEOUT_MS,
  MCP_TAIL_DEFAULT_LINES,
  MCP_TAIL_MAX_LINES,
} from '../../shared/mcp/limits'
import { isSafeLocalPath, isStrictPath } from '../utils/validation'
import { toolError } from './errors'

export function requireRemotePath(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw toolError('INVALID_PATH', 'path is required')
  }
  if (!isStrictPath(path)) {
    throw toolError('INVALID_PATH', 'path is invalid or contains parent-directory segments')
  }
  return path.replace(/\/+$/, '') || '/'
}

export function requireLocalPath(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw toolError('INVALID_PATH', 'localPath is required')
  }
  if (!isSafeLocalPath(path)) {
    throw toolError('INVALID_PATH', 'localPath must be an absolute path without parent-directory segments')
  }
  return path
}

export function clampTimeout(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MCP_DEFAULT_TIMEOUT_MS
  const n = Math.floor(raw)
  if (n < MCP_MIN_TIMEOUT_MS) return MCP_MIN_TIMEOUT_MS
  if (n > MCP_MAX_TIMEOUT_MS) return MCP_MAX_TIMEOUT_MS
  return n
}

export function clampJobTimeout(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MCP_DEFAULT_JOB_TIMEOUT_MS
  const n = Math.floor(raw)
  if (n < MCP_MIN_TIMEOUT_MS) return MCP_MIN_TIMEOUT_MS
  if (n > MCP_MAX_JOB_TIMEOUT_MS) return MCP_MAX_JOB_TIMEOUT_MS
  return n
}

export function clampConcurrency(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MCP_DEFAULT_FANOUT_CONCURRENCY
  return Math.min(MCP_MAX_FANOUT_CONCURRENCY, Math.max(1, Math.floor(raw)))
}

export function clampOffset(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0) return 0
  return Math.floor(raw)
}

export function clampLength(raw: unknown, max: number): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return max
  return Math.min(max, Math.max(1, Math.floor(raw)))
}

export function clampLines(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MCP_TAIL_DEFAULT_LINES
  return Math.min(MCP_TAIL_MAX_LINES, Math.max(1, Math.floor(raw)))
}

export function parseEncoding(raw: unknown): 'utf8' | 'base64' {
  return raw === 'base64' ? 'base64' : 'utf8'
}

export function parseStdin(raw: unknown): string | '' | false {
  if (raw == null) return ''
  if (typeof raw !== 'string') return false
  if (raw.length > MCP_MAX_STDIN_CHARS) return false
  return raw
}

export async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return []
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      out[index] = await fn(items[index])
    }
  })
  await Promise.all(workers)
  return out
}
