/** Connection-scoped path bookmark (global bookmarks are kept). */
export function isConnectionScopedBookmark(
  record: { scope?: unknown; connectionId?: unknown },
  connectionId: string,
): boolean {
  if (!connectionId) return false
  if (record.scope === 'global') return false
  return record.connectionId === connectionId
}

/**
 * Remove one connection's path bookmarks from the persisted JSON blob.
 * Malformed entries are left untouched. Returns the original string when nothing changed.
 */
export function stripConnectionPathBookmarks(
  raw: string | null,
  connectionId: string,
): { changed: boolean; value: string | null } {
  if (!raw || !connectionId) return { changed: false, value: raw }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { changed: false, value: raw }
  }
  if (!Array.isArray(parsed)) return { changed: false, value: raw }
  const next = parsed.filter((item) => {
    if (!item || typeof item !== 'object') return true
    return !isConnectionScopedBookmark(item as { scope?: unknown; connectionId?: unknown }, connectionId)
  })
  if (next.length === parsed.length) return { changed: false, value: raw }
  return { changed: true, value: next.length ? JSON.stringify(next) : null }
}
