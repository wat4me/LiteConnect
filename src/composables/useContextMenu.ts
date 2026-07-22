import { ref } from 'vue'
import type { FileEntry } from '../env.d.ts'

const MENU_ITEM_HEIGHT = 32
const MENU_PADDING = 8

export function useContextMenu() {
  const contextMenuVisible = ref(false)
  const contextMenuX = ref(0)
  const contextMenuY = ref(0)
  const contextMenuEntry = ref<FileEntry | null>(null)
  const menuItemCount = ref(4)

  function showContextMenu(e: MouseEvent, entry: FileEntry) {
    e.preventDefault()
    e.stopPropagation()
    contextMenuEntry.value = entry

    const menuHeight = menuItemCount.value * MENU_ITEM_HEIGHT + MENU_PADDING
    const viewH = window.innerHeight
    const viewW = window.innerWidth
    const x = e.clientX
    const y = e.clientY

    if (y + menuHeight > viewH) {
      contextMenuY.value = Math.max(4, viewH - menuHeight - 4)
    } else {
      contextMenuY.value = y
    }

    const menuWidth = 160
    if (x + menuWidth > viewW) {
      contextMenuX.value = Math.max(4, viewW - menuWidth - 4)
    } else {
      contextMenuX.value = x
    }

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
