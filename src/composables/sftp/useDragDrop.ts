import { ref } from 'vue'

export type DropUploadItem = {
  name: string
  path: string
  isDirectory: boolean
}

function baseName(filePath: string): string {
  const cleaned = filePath.replace(/[/\\]+$/, '')
  const parts = cleaned.split(/[/\\]/)
  return parts[parts.length - 1] || cleaned
}

function hasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer?.types?.includes('Files')
}

/**
 * Collect local files/folders from a drop event.
 * Uses webkitGetAsEntry when available; falls back to path stat via main process.
 *
 * Drop target path is resolved by the host (e.g. hovered folder row).
 */
export function useDragDrop(
  onItemsDropped: (items: DropUploadItem[], targetPath?: string) => void,
  getDropTargetPath?: () => string | undefined,
) {
  const isDragOver = ref(false)
  /** Nested dragenter/leave counter so child nodes don't flicker off */
  let dragDepth = 0

  function onDragEnter(e: DragEvent) {
    if (!hasFiles(e)) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth += 1
    isDragOver.value = true
  }

  function onDragOver(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (hasFiles(e)) {
      isDragOver.value = true
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
  }

  function onDragLeave(e: DragEvent) {
    if (!hasFiles(e) && dragDepth === 0) return
    e.preventDefault()
    e.stopPropagation()
    dragDepth = Math.max(0, dragDepth - 1)
    if (dragDepth === 0) {
      isDragOver.value = false
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    dragDepth = 0
    isDragOver.value = false

    const targetPath = getDropTargetPath?.()

    const items = e.dataTransfer?.items
    const collected: Array<{ name: string; path: string; isDirectory?: boolean }> = []

    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (!file) continue
        const localPath = window.LiteConnect.getPathForFile(file)
        if (!localPath) continue
        const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
        collected.push({
          name: file.name || baseName(localPath),
          path: localPath,
          isDirectory: entry ? entry.isDirectory : undefined,
        })
      }
    } else {
      const files = Array.from(e.dataTransfer?.files || [])
      for (const file of files) {
        const localPath = window.LiteConnect.getPathForFile(file)
        if (!localPath) continue
        collected.push({
          name: file.name || baseName(localPath),
          path: localPath,
        })
      }
    }

    if (collected.length === 0) return

    const resolved: DropUploadItem[] = []
    for (const item of collected) {
      let isDir = item.isDirectory
      if (isDir === undefined) {
        try {
          isDir = await window.LiteConnect.isLocalDirectory(item.path)
        } catch {
          isDir = false
        }
      }
      resolved.push({
        name: item.name,
        path: item.path,
        isDirectory: !!isDir,
      })
    }

    onItemsDropped(resolved, targetPath)
  }

  function resetDragState() {
    dragDepth = 0
    isDragOver.value = false
  }

  return {
    isDragOver,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    resetDragState,
  }
}
