import type { Ref } from 'vue'
import type { FileEntry } from '../../env.d.ts'

export type SftpTreeFlatRow =
  | { kind: 'dir'; name: string; path: string; depth: number; entry: FileEntry | null }
  | { kind: 'file'; name: string; path: string; depth: number; entry: FileEntry }
  | { kind: 'more'; path: string; parentPath: string; depth: number; shown: number; total: number }

/**
 * Keyboard navigation for SftpDirTree (arrows / Enter / Space / F2 / Delete / Ctrl+F).
 */
export function useSftpTreeKeyboard(deps: {
  visibleRows: Ref<SftpTreeFlatRow[]>
  focusedPath: Ref<string>
  isExpanded: (path: string) => boolean
  isCurrent: (path: string) => boolean
  canEdit?: (name: string) => boolean
  selectedFileEntries: () => FileEntry[]
  focusRow: (path: string) => void
  toggleSelect: (entry: FileEntry) => void
  showMoreFiles: (parentPath: string) => void
  toggleSearch: () => void
  onSelectDir: (path: string) => void
  onToggleDir: (path: string) => void
  onEdit: (entry: FileEntry) => void
  onRename: (entry: FileEntry) => void
  onDeleteMany: (entries: FileEntry[]) => void
}) {
  function handleKeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
      e.preventDefault()
      e.stopPropagation()
      deps.toggleSearch()
      return
    }

    if (e.target instanceof HTMLInputElement) return
    const rows = deps.visibleRows.value
    if (rows.length === 0) return
    let index = rows.findIndex((row) => row.path === deps.focusedPath.value)
    if (index < 0) {
      index = Math.max(0, rows.findIndex((row) => row.kind === 'dir' && deps.isCurrent(row.path)))
    }
    if (index < 0) index = 0
    const row = rows[index]
    if (!row) return

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const nextIndex = e.key === 'ArrowDown'
        ? Math.min(rows.length - 1, index + 1)
        : Math.max(0, index - 1)
      deps.focusRow(rows[nextIndex].path)
      return
    }
    if (e.key === 'ArrowRight' && row.kind === 'dir') {
      e.preventDefault()
      if (!deps.isExpanded(row.path)) deps.onToggleDir(row.path)
      else if (rows[index + 1]) deps.focusRow(rows[index + 1].path)
      return
    }
    if (e.key === 'ArrowLeft' && row.kind === 'dir') {
      e.preventDefault()
      if (deps.isExpanded(row.path)) deps.onToggleDir(row.path)
      else {
        // Root `/` is not rendered as a row; stop when parent is root.
        const parent = row.path.slice(0, row.path.lastIndexOf('/')) || ''
        if (parent && parent !== '/') deps.focusRow(parent)
      }
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (row.kind === 'dir') deps.onSelectDir(row.path)
      else if (row.kind === 'more') deps.showMoreFiles(row.parentPath)
      else if (deps.canEdit?.(row.name)) deps.onEdit(row.entry)
      else deps.toggleSelect(row.entry)
      return
    }
    if (e.key === ' ' && row.kind === 'file') {
      e.preventDefault()
      deps.toggleSelect(row.entry)
      return
    }
    if (e.key === 'Delete' && row.kind === 'file') {
      e.preventDefault()
      const selected = deps.selectedFileEntries()
      const targets = selected.length > 0 ? selected : [row.entry]
      deps.onDeleteMany(targets)
      return
    }
    if (e.key === 'F2' && row.kind === 'file' && row.entry) {
      e.preventDefault()
      deps.onRename(row.entry)
    }
  }

  return { handleKeydown }
}
