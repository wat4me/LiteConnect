import { ref } from 'vue'
import type { FileEntry } from '@/env.d.ts'

export function useContextMenu() {
  const contextMenuVisible = ref(false)
  const contextMenuX = ref(0)
  const contextMenuY = ref(0)
  const contextMenuEntry = ref<FileEntry | null>(null)

  function showContextMenu(e: MouseEvent, entry: FileEntry) {
    e.preventDefault()
    e.stopPropagation()
    contextMenuEntry.value = entry
    // Cursor point; SftpContextMenu measures real size and clamps to viewport
    contextMenuX.value = e.clientX
    contextMenuY.value = e.clientY
    contextMenuVisible.value = true
  }

  function hideContextMenu() {
    contextMenuVisible.value = false
    contextMenuEntry.value = null
  }

  function onContextMenu(e: MouseEvent, entry: FileEntry) {
    showContextMenu(e, entry)
  }

  return {
    contextMenuVisible,
    contextMenuX,
    contextMenuY,
    contextMenuEntry,
    showContextMenu,
    hideContextMenu,
    onContextMenu,
  }
}
