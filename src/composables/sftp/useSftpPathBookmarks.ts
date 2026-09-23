import { computed, ref } from 'vue'
import type { SftpPathBookmark, SftpPathBookmarkScope } from '@shared/types/sftp'
import { isConnectionScopedBookmark } from '@shared/sftp/pathBookmarks'
import {
  bookmarksForConnection,
  findConnectionBookmarkForPath,
  findGlobalBookmarkForPath,
  moveBookmarkWithinScope,
  normalizeBookmarkPath,
  parseSftpPathBookmarks,
  reorderBookmarkWithinScope,
  replaceBookmarkPath,
  SFTP_PATH_BOOKMARK_LIMIT,
  SftpBookmarkLimitError,
} from '@/utils/sftp/pathBookmarks'

const STORAGE_KEY = 'sftp-path-bookmarks' as const
const bookmarks = ref<SftpPathBookmark[]>([])
let loadPromise: Promise<void> | null = null
let saveTail: Promise<void> = Promise.resolve()

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

async function ensureLoaded(): Promise<void> {
  installExternalSync()
  if (loadPromise) return loadPromise
  loadPromise = window.LiteConnect.getRendererState(STORAGE_KEY)
    .then((raw) => { bookmarks.value = parseSftpPathBookmarks(raw) })
    .catch((err) => {
      loadPromise = null
      throw err
    })
  return loadPromise
}

async function commit(next: SftpPathBookmark[]): Promise<void> {
  const previous = bookmarks.value
  bookmarks.value = next.slice(0, SFTP_PATH_BOOKMARK_LIMIT)
  const payload = JSON.stringify(bookmarks.value)
  const write = saveTail.then(() => window.LiteConnect.setRendererState(STORAGE_KEY, payload))
  saveTail = write.catch(() => {})
  try {
    await write
  } catch (err) {
    // Only roll back when no newer mutation has replaced this snapshot.
    if (JSON.stringify(bookmarks.value) === payload) bookmarks.value = previous
    throw err
  }
}

export function useSftpPathBookmarks(connectionId: () => string) {
  const grouped = computed(() => bookmarksForConnection(bookmarks.value, connectionId()))
  const visible = computed(() => [...grouped.value.connection, ...grouped.value.global])

  async function add(input: {
    name: string
    path: string
    scope: SftpPathBookmarkScope
  }): Promise<SftpPathBookmark> {
    await ensureLoaded()
    const path = normalizeBookmarkPath(input.path)
    const owner = input.scope === 'connection' ? connectionId() : undefined
    const duplicate = bookmarks.value.find((item) =>
      item.scope === input.scope
      && item.path === path
      && (input.scope === 'global' || item.connectionId === owner),
    )
    if (duplicate) return duplicate
    if (bookmarks.value.length >= SFTP_PATH_BOOKMARK_LIMIT) {
      throw new SftpBookmarkLimitError()
    }
    const now = Date.now()
    const item: SftpPathBookmark = {
      id: createId(),
      name: input.name.trim().slice(0, 80),
      path,
      scope: input.scope,
      connectionId: owner,
      createdAt: now,
      updatedAt: now,
    }
    await commit([...bookmarks.value, item])
    return item
  }

  async function remove(id: string): Promise<void> {
    await ensureLoaded()
    await commit(bookmarks.value.filter((item) => item.id !== id))
  }

  async function rename(id: string, name: string): Promise<void> {
    await ensureLoaded()
    const clean = name.trim().slice(0, 80)
    if (!clean) return
    await commit(bookmarks.value.map((item) => item.id === id
      ? { ...item, name: clean, updatedAt: Date.now() }
      : item))
  }

  async function move(id: string, direction: -1 | 1): Promise<void> {
    await ensureLoaded()
    await commit(moveBookmarkWithinScope(bookmarks.value, id, direction))
  }

  async function reorder(draggedId: string, targetId: string, place: 'before' | 'after'): Promise<void> {
    await ensureLoaded()
    const next = reorderBookmarkWithinScope(bookmarks.value, draggedId, targetId, place)
    if (next.length === bookmarks.value.length && next.every((item, index) => item.id === bookmarks.value[index]?.id)) {
      return
    }
    await commit(next)
  }

  async function updatePath(id: string, path: string): Promise<'ok' | 'duplicate' | 'missing'> {
    await ensureLoaded()
    const replaced = replaceBookmarkPath(bookmarks.value, id, path)
    if (replaced.result !== 'ok' || replaced.bookmarks === bookmarks.value) return replaced.result
    const changed = replaced.bookmarks.some((item, index) => item !== bookmarks.value[index])
    if (!changed) return replaced.result
    await commit(replaced.bookmarks)
    return 'ok'
  }

  function findConnectionPath(path: string): SftpPathBookmark | null {
    return findConnectionBookmarkForPath(bookmarks.value, connectionId(), path)
  }

  function findGlobalPath(path: string): SftpPathBookmark | null {
    return findGlobalBookmarkForPath(bookmarks.value, path)
  }

  return {
    bookmarks,
    grouped,
    visible,
    ensureLoaded,
    add,
    remove,
    rename,
    move,
    reorder,
    updatePath,
    findConnectionPath,
    findGlobalPath,
  }
}

let externalSyncInstalled = false

export async function forgetConnectionPathBookmarks(connectionId: string): Promise<void> {
  if (!connectionId) return
  await ensureLoaded()
  const next = bookmarks.value.filter((item) => !isConnectionScopedBookmark(item, connectionId))
  if (next.length === bookmarks.value.length) return
  await commit(next)
}

function installExternalSync(): void {
  if (externalSyncInstalled) return
  const api = typeof window !== 'undefined' ? window.LiteConnect : undefined
  if (!api?.onSftpPathBookmarksChanged) return
  externalSyncInstalled = true
  api.onSftpPathBookmarksChanged((connectionId) => {
    void forgetConnectionPathBookmarks(connectionId).catch((err) => {
      console.error('[SFTP Bookmarks] failed to drop connection bookmarks', err)
    })
  })
}

installExternalSync()
