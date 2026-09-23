import type { SftpPathBookmark, SftpPathBookmarkScope } from '@shared/types/sftp'

export const SFTP_PATH_BOOKMARK_LIMIT = 300

export function normalizeBookmarkPath(value: unknown): string {
  if (typeof value !== 'string') return ''
  let path = value.trim().replace(/\\/g, '/')
  if (!path.startsWith('/')) path = `/${path}`
  path = path.replace(/\/{2,}/g, '/').replace(/\/$/, '')
  return path || '/'
}

export function defaultBookmarkName(path: string): string {
  const clean = normalizeBookmarkPath(path)
  if (clean === '/') return '/'
  return clean.split('/').filter(Boolean).at(-1) || clean
}

export function parseSftpPathBookmarks(raw: string | null): SftpPathBookmark[] {
  if (!raw) return []
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(value)) return []

  const seen = new Set<string>()
  const now = Date.now()
  const result: SftpPathBookmark[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const scope: SftpPathBookmarkScope = record.scope === 'global' ? 'global' : 'connection'
    const connectionId = typeof record.connectionId === 'string' ? record.connectionId.trim() : ''
    if (scope === 'connection' && !connectionId) continue
    const path = normalizeBookmarkPath(record.path)
    if (!path) continue
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim().slice(0, 100) : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    const name = typeof record.name === 'string' && record.name.trim()
      ? record.name.trim().slice(0, 80)
      : defaultBookmarkName(path)
    result.push({
      id,
      name,
      path,
      scope,
      connectionId: scope === 'connection' ? connectionId : undefined,
      createdAt: typeof record.createdAt === 'number' && Number.isFinite(record.createdAt)
        ? record.createdAt
        : now,
      updatedAt: typeof record.updatedAt === 'number' && Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : now,
    })
    if (result.length >= SFTP_PATH_BOOKMARK_LIMIT) break
  }
  return result
}

export function bookmarksForConnection(
  bookmarks: readonly SftpPathBookmark[],
  connectionId: string,
): { connection: SftpPathBookmark[]; global: SftpPathBookmark[] } {
  return {
    connection: bookmarks.filter(
      (item) => item.scope === 'connection' && item.connectionId === connectionId,
    ),
    global: bookmarks.filter((item) => item.scope === 'global'),
  }
}

export class SftpBookmarkLimitError extends Error {
  readonly code = 'SFTP_BOOKMARK_LIMIT'
  constructor() {
    super('SFTP bookmark limit reached')
    this.name = 'SftpBookmarkLimitError'
  }
}

export function findConnectionBookmarkForPath(
  bookmarks: readonly SftpPathBookmark[],
  connectionId: string,
  path: string,
): SftpPathBookmark | null {
  const clean = normalizeBookmarkPath(path)
  if (!clean || !connectionId) return null
  return bookmarks.find(
    (item) => item.scope === 'connection'
      && item.connectionId === connectionId
      && item.path === clean,
  ) ?? null
}

export function findGlobalBookmarkForPath(
  bookmarks: readonly SftpPathBookmark[],
  path: string,
): SftpPathBookmark | null {
  const clean = normalizeBookmarkPath(path)
  if (!clean) return null
  return bookmarks.find((item) => item.scope === 'global' && item.path === clean) ?? null
}

export function findBookmarkForPath(
  bookmarks: readonly SftpPathBookmark[],
  connectionId: string,
  path: string,
): SftpPathBookmark | null {
  return findConnectionBookmarkForPath(bookmarks, connectionId, path)
    ?? findGlobalBookmarkForPath(bookmarks, path)
}

export function moveBookmarkWithinScope(
  bookmarks: readonly SftpPathBookmark[],
  id: string,
  direction: -1 | 1,
): SftpPathBookmark[] {
  const source = bookmarks.find((item) => item.id === id)
  if (!source) return [...bookmarks]
  const peers = bookmarks.filter((item) =>
    item.scope === source.scope
    && (source.scope === 'global' || item.connectionId === source.connectionId),
  )
  const peerIndex = peers.findIndex((item) => item.id === id)
  const target = peers[peerIndex + direction]
  if (!target) return [...bookmarks]

  const next = [...bookmarks]
  const from = next.findIndex((item) => item.id === id)
  const to = next.findIndex((item) => item.id === target.id)
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

export function reorderBookmarkWithinScope(
  bookmarks: readonly SftpPathBookmark[],
  draggedId: string,
  targetId: string,
  place: 'before' | 'after',
): SftpPathBookmark[] {
  if (!draggedId || draggedId === targetId) return [...bookmarks]
  const dragged = bookmarks.find((item) => item.id === draggedId)
  const target = bookmarks.find((item) => item.id === targetId)
  if (!dragged || !target) return [...bookmarks]
  if (dragged.scope !== target.scope) return [...bookmarks]
  if (dragged.scope === 'connection' && dragged.connectionId !== target.connectionId) {
    return [...bookmarks]
  }
  const next = bookmarks.filter((item) => item.id !== draggedId)
  let index = next.findIndex((item) => item.id === targetId)
  if (index < 0) return [...bookmarks]
  if (place === 'after') index += 1
  next.splice(index, 0, dragged)
  return next
}

export function replaceBookmarkPath(
  bookmarks: readonly SftpPathBookmark[],
  id: string,
  path: string,
): { bookmarks: SftpPathBookmark[]; result: 'ok' | 'duplicate' | 'missing' } {
  const clean = normalizeBookmarkPath(path)
  const current = bookmarks.find((item) => item.id === id)
  if (!current || !clean) return { bookmarks: [...bookmarks], result: 'missing' }
  if (current.path === clean) return { bookmarks: [...bookmarks], result: 'ok' }
  const duplicate = bookmarks.find((item) =>
    item.id !== id
    && item.scope === current.scope
    && item.path === clean
    && (current.scope === 'global' || item.connectionId === current.connectionId),
  )
  if (duplicate) return { bookmarks: [...bookmarks], result: 'duplicate' }
  return {
    result: 'ok',
    bookmarks: bookmarks.map((item) => item.id === id
      ? { ...item, path: clean, updatedAt: Date.now() }
      : item),
  }
}
