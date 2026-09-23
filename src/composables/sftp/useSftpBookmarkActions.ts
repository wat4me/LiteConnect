import { computed, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { SftpPathBookmark, SftpPathBookmarkScope } from '@shared/types/sftp'
import { appConfirm, appPrompt } from '@/composables/app/useAppDialog'
import { defaultBookmarkName, normalizeBookmarkPath, SftpBookmarkLimitError } from '@/utils/sftp/pathBookmarks'
import { useSftpPathBookmarks } from './useSftpPathBookmarks'

/** Bookmark dialogs and mutations used by the SFTP sidebar and path bar. */
export function useSftpBookmarkActions(connectionId: () => string, currentPath: Ref<string>) {
  const { t } = useI18n()
  const pathBookmarks = useSftpPathBookmarks(connectionId)
  const currentConnectionBookmark = computed(() => pathBookmarks.findConnectionPath(currentPath.value))

  function bookmarkError(err: unknown): void {
    console.error('[SFTP Bookmarks]', err)
    if (err instanceof SftpBookmarkLimitError) {
      ElMessage.error(t('sftp.bookmarkLimitReached'))
      return
    }
    ElMessage.error(t('sftp.bookmarkSaveFailed'))
  }

  async function addPathBookmark(path: string, scope: SftpPathBookmarkScope, askName: boolean): Promise<void> {
    const cleanPath = normalizeBookmarkPath(path)
    let name = defaultBookmarkName(cleanPath)
    if (askName) {
      try {
        name = await appPrompt({
          title: scope === 'global' ? t('sftp.addGlobalBookmark') : t('sftp.addConnectionBookmark'),
          message: cleanPath,
          inputValue: name,
          inputPlaceholder: t('sftp.bookmarkNamePlaceholder'),
          maxLength: 80,
        })
      } catch {
        return
      }
    }
    try {
      const before = pathBookmarks.bookmarks.value.find((item) =>
        item.scope === scope
        && item.path === cleanPath
        && (scope === 'global' || item.connectionId === connectionId()),
      )
      await pathBookmarks.add({ name, path: cleanPath, scope })
      ElMessage.success(before ? t('sftp.bookmarkAlreadyExists') : t('sftp.bookmarkAdded'))
    } catch (err) {
      bookmarkError(err)
    }
  }

  async function toggleCurrentPathBookmark(): Promise<void> {
    if (!currentPath.value) return
    const existing = pathBookmarks.findConnectionPath(currentPath.value)
    try {
      if (existing) {
        await pathBookmarks.remove(existing.id)
        ElMessage.success(t('sftp.bookmarkRemoved'))
      } else {
        await addPathBookmark(currentPath.value, 'connection', false)
      }
    } catch (err) {
      bookmarkError(err)
    }
  }

  async function handleAddBookmark(scope: SftpPathBookmarkScope): Promise<void> {
    if (!currentPath.value) return
    await addPathBookmark(currentPath.value, scope, scope === 'global')
  }

  async function handleRenameBookmark(bookmark: SftpPathBookmark): Promise<void> {
    let name: string
    try {
      name = await appPrompt({
        title: t('sftp.renameBookmark'),
        message: bookmark.path,
        inputValue: bookmark.name,
        inputPlaceholder: t('sftp.bookmarkNamePlaceholder'),
        maxLength: 80,
      })
    } catch {
      return
    }
    try {
      await pathBookmarks.rename(bookmark.id, name)
    } catch (err) {
      bookmarkError(err)
    }
  }

  async function handleRemoveBookmark(bookmark: SftpPathBookmark): Promise<void> {
    try {
      await appConfirm({
        title: t('sftp.deleteBookmark'),
        message: t('sftp.deleteBookmarkMessage', { name: bookmark.name }),
        detail: bookmark.path,
        danger: true,
      })
      await pathBookmarks.remove(bookmark.id)
      ElMessage.success(t('sftp.bookmarkRemoved'))
    } catch (err) {
      if (err !== 'cancel') bookmarkError(err)
    }
  }

  async function handleMoveBookmark(bookmark: SftpPathBookmark, direction: -1 | 1): Promise<void> {
    try {
      await pathBookmarks.move(bookmark.id, direction)
    } catch (err) {
      bookmarkError(err)
    }
  }

  async function handleEditBookmarkPath(bookmark: SftpPathBookmark): Promise<void> {
    let nextPath: string
    try {
      nextPath = await appPrompt({
        title: t('sftp.editBookmarkPath'),
        message: bookmark.name,
        detail: bookmark.path,
        inputValue: bookmark.path,
        inputPlaceholder: t('sftp.bookmarkPathPlaceholder'),
        maxLength: 500,
      })
    } catch {
      return
    }
    try {
      const result = await pathBookmarks.updatePath(bookmark.id, nextPath)
      if (result === 'duplicate') ElMessage.info(t('sftp.bookmarkAlreadyExists'))
    } catch (err) {
      bookmarkError(err)
    }
  }

  async function handleReorderBookmark(
    draggedId: string,
    targetId: string,
    place: 'before' | 'after',
  ): Promise<void> {
    try {
      await pathBookmarks.reorder(draggedId, targetId, place)
    } catch (err) {
      bookmarkError(err)
    }
  }

  return {
    pathBookmarks,
    currentConnectionBookmark,
    bookmarkError,
    addPathBookmark,
    toggleCurrentPathBookmark,
    handleAddBookmark,
    handleRenameBookmark,
    handleRemoveBookmark,
    handleMoveBookmark,
    handleEditBookmarkPath,
    handleReorderBookmark,
  }
}
