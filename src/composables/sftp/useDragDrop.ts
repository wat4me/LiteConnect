import { ref } from 'vue'

export type DropUploadItem = {
  name: string
  path: string
  isDirectory: boolean
}

/**
 * Scratch directories that must never be synthesised as an upload root.
 *
 * Archive viewers (7-Zip / WinRAR) and browser download lists do not hand over
 * the file the user grabbed: they unpack it into the scratch directory first and
 * hand over *that* copy, whose original location is already gone. The paths look
 * ordinary, so the only way to spot them is by where they live. Inferring a
 * folder root from such a path uploads scratch copies — at worst a whole
 * ancestor directory such as the user profile — which is never what was meant.
 *
 * The scratch path is resolved by the main process (`os.tmpdir()`), so this is
 * an exact comparison against the real location rather than a guess based on
 * conventional folder names: a redirected `%TEMP%` is handled correctly, and a
 * folder merely *named* "Temp" somewhere else is left alone.
 *
 * Everything at or above the scratch directory is refused, not just the scratch
 * directory itself. A candidate root is built by walking *up* from the dropped
 * listings, and from `…\Temp\a.xml` that walk passes through `…\Local`,
 * `…\AppData` and the profile folder; accepting any of them would upload far
 * more than the user grabbed. A directory strictly *below* the scratch root is
 * allowed — that is a folder the user deliberately opened and dragged out.
 */
let scratchDirs: string[] = []

/**
 * Register the machine's scratch directories so drops can be screened.
 *
 * Called once at startup with `os.tmpdir()`.
 */
export function setScratchDirs(dirs: string[]): void {
  scratchDirs = dirs.map((d) => toPosix(d).toLowerCase()).filter(Boolean)
}

function baseName(filePath: string): string {
  const cleaned = filePath.replace(/[/\\]+$/, '')
  const parts = cleaned.split(/[/\\]/)
  return parts[parts.length - 1] || cleaned
}

function hasFiles(e: DragEvent): boolean {
  return !!e.dataTransfer?.types?.includes('Files')
}

/** A raw dropped path (from webUtils.getPathForFile) plus a best-known type. */
export type DropPathInfo = {
  path: string
  name: string
  isDirectory?: boolean
}

function isUnderRecycleBin(posix: string): boolean {
  return /(^|\/)\$recycle\.bin(\/|$)/i.test(posix)
}

/** True when `dir` is one of the scratch roots or any directory above it. */
function isScratchOrAbove(posix: string): boolean {
  const lower = toPosix(posix).toLowerCase()
  if (!lower) return false
  return scratchDirs.some((scratch) => lower === scratch || isPathInside(scratch, lower))
}

/** Lower-cased, forward-slash form used for all path comparisons. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '')
}

/**
 * True when `dir` is safe to upload as a synthesised folder root.
 *
 * Rejected: the Recycle Bin, `%TEMP%` itself, and every directory above it. The
 * ancestor case is the important one — walking up from `…/Temp/spring-a.xml`
 * reaches `…/Local` and then the user profile directory, and accepting either
 * would upload a directory far broader than what the user grabbed.
 */
export function isSynthesizableUploadRoot(dir: string): boolean {
  const posix = toPosix(dir)
  if (!posix) return false
  if (isUnderRecycleBin(posix)) return false
  return !isScratchOrAbove(posix)
}

/** True when `parent` contains `child` (strictly below it). */
export function isPathInside(child: string, parent: string): boolean {
  const c = toPosix(child).toLowerCase()
  const p = toPosix(parent).toLowerCase()
  if (!p) return false
  return c.startsWith(p + '/')
}

/**
 * Longest directory shared by every listing.
 *
 * Dropping a folder that is fully expanded hands us *its direct children*, not
 * the folder itself, so the dropped root can only be recovered from the shared
 * parent of the listings. Returns '' when the listings are unrelated (a loose
 * multi-file drop that must stay flat), when the shared directory would be a
 * drive root (never guess something as broad as `D:/` — that would upload the
 * whole drive), or when it is `%TEMP%` or one of its ancestors, which means the
 * entries are unpacked copies from an archive viewer rather than a folder.
 */
export function commonDirPrefix(paths: string[]): string {
  if (paths.length < 2) return ''

  const dirs = paths.map((p) => {
    const posix = toPosix(p)
    const idx = posix.lastIndexOf('/')
    return idx > 0 ? posix.slice(0, idx) : posix
  })
  if (dirs.length === 0) return ''

  const first = dirs[0]
  const segments = first.split('/')
  for (let take = segments.length; take > 0; take--) {
    const candidate = segments.slice(0, take).join('/')
    // A drive root ("D:") is never a legitimate upload root: the only way the
    // listings agree on it is that they are unrelated.
    if (/^[a-zA-Z]:$/.test(candidate) || candidate === '') continue
    // A candidate at or inside a scratch directory is terminal, not skippable:
    // the listings are unpacked copies, and no *ancestor* is a valid root either
    // (that is the whole point of refusing the scratch tree). Returning '' here
    // keeps the caller from escalating to something as broad as the profile dir.
    if (!isSynthesizableUploadRoot(candidate)) return ''
    const ok = dirs.every(
      (d) => d.toLowerCase() === candidate.toLowerCase() ||
        isPathInside(d, candidate),
    )
    if (ok) return candidate
  }
  return ''
}

/**
 * Turn one drop's raw listings into the upload set.
 *
 * - A single directory listing is uploaded as-is (structure preserved).
 * - A batch of listings sharing a parent directory is uploaded as that parent
 *   directory, so the outer folder + subdirectory layout survive. This is the
 *   shape produced when a folder is dragged in and the OS hands us its children.
 * - Unrelated listings stay individual files (flat), so dropping a handful of
 *   loose files never invents a folder.
 *
 * Entries dropped this way are never uploaded elsewhere, so an empty result means
 * "not uploadable" rather than "nothing to do" — the caller surfaces that.
 */
export function expandDroppedFiles(files: DropPathInfo[]): DropUploadItem[] {
  const asEntries = (items: DropUploadItem[]) => items.filter(Boolean)

  if (files.length === 0) return []

  const droppedDir = files.find((f) => f.isDirectory)
  if (droppedDir) {
    // A real folder entry still has to look plausible. A scratch directory here
    // means the shell handed us a temp copy of something, not the folder itself.
    if (!isSynthesizableUploadRoot(droppedDir.path)) return []
    return asEntries([
      { name: droppedDir.name || baseName(droppedDir.path), path: droppedDir.path, isDirectory: true },
    ])
  }

  const shared = commonDirPrefix(files.map((f) => f.path))
  if (shared) {
    return asEntries([
      { name: baseName(shared), path: shared, isDirectory: true },
    ])
  }

  // Refuse scratch-only listings outright: uploading individual copies out of
  // %TEMP% is never what the user meant, and silently doing it looks like a bug.
  const allUntrusted = files.every((f) => {
    const posix = toPosix(f.path)
    const idx = posix.lastIndexOf('/')
    const parent = idx > 0 ? posix.slice(0, idx) : posix
    return !isSynthesizableUploadRoot(parent)
  })
  if (allUntrusted) return []

  return asEntries(
    files.map((f) => ({
      name: f.name || baseName(f.path),
      path: f.path,
      isDirectory: false,
    })),
  )
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
  /** Called when a drop carried nothing uploadable (e.g. scratch copies out of an archive viewer). */
  onDropRejected?: (reason: 'untrusted-source') => void,
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

    const collected: DropPathInfo[] = []

    // `dataTransfer.files` is the path-bearing source on Windows/Electron and is
    // tried first; `items` is only a fallback (some drags, e.g. out of an
    // archive viewer, populate items but hand back files whose path is empty).
    const dtFiles = Array.from(e.dataTransfer?.files || [])
    for (const file of dtFiles) {
      let localPath = ''
      try {
        localPath = window.LiteConnect.getPathForFile(file)
      } catch {
        localPath = ''
      }
      if (!localPath) continue
      collected.push({ name: file.name || baseName(localPath), path: localPath })
    }

    if (collected.length === 0) {
      const items = e.dataTransfer?.items
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i]
          if (item.kind !== 'file') continue
          const file = item.getAsFile()
          if (!file) continue
          let localPath = ''
          try {
            localPath = window.LiteConnect.getPathForFile(file)
          } catch {
            localPath = ''
          }
          if (!localPath) continue
          const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null
          collected.push({
            name: file.name || baseName(localPath),
            path: localPath,
            isDirectory: entry ? entry.isDirectory : undefined,
          })
        }
      }
    }

    if (collected.length === 0) {
      // No usable path at all (not a file drop we can act on).
      return
    }

    const resolved: DropPathInfo[] = []
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

    const uploadItems = expandDroppedFiles(resolved)
    if (uploadItems.length === 0) {
      // The drop had file entries but nothing uploadable (scratch copies from an
      // archive viewer). Tell the user instead of silently doing nothing.
      onDropRejected?.('untrusted-source')
      return
    }
    onItemsDropped(uploadItems, targetPath)
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
