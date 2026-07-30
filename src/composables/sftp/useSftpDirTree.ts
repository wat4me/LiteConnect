import { ref, type Ref } from 'vue'
import { t } from '../../i18n'
import type { FileEntry } from '../../env.d.ts'

function cleanRemotePath(path: string): string {
  return path.replace(/\/+$/, '') || '/'
}

/** 路径的所有祖先含自身：/home/u → ['/', '/home', '/home/u'] */
export function ancestorPaths(path: string): string[] {
  const clean = cleanRemotePath(path)
  if (clean === '/') return ['/']
  const parts = clean.split('/').filter(Boolean)
  const out: string[] = ['/']
  let acc = ''
  for (const part of parts) {
    acc += `/${part}`
    out.push(acc)
  }
  return out
}

function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    // isDirectory includes symlink→dir (resolved by backend)
    const ad = !!a.isDirectory
    const bd = !!b.isDirectory
    if (ad !== bd) return ad ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

function normalizeEntries(parentPath: string, entries: FileEntry[]): FileEntry[] {
  const clean = cleanRemotePath(parentPath)
  return sortEntries(
    entries
      .filter((e) => e.name !== '.' && e.name !== '..')
      .map((e) => ({
        ...e,
        path: cleanRemotePath(e.path || (clean === '/' ? `/${e.name}` : `${clean}/${e.name}`)),
      })),
  )
}

/**
 * 统一树：文件夹可展开，文件不可展开。
 * 只加载用户展开/进入过的目录；跟随路径展开，不自动收起。
 */
export function useSftpDirTree(sessionId: () => string) {
  /** path → 该目录下完整条目（文件夹 + 文件） */
  const entriesByPath = ref<Record<string, FileEntry[]>>({})
  const expandedPaths = ref<Set<string>>(new Set())
  const loadingPaths = ref<Set<string>>(new Set())
  const treeError = ref('')

  function isExpanded(path: string): boolean {
    return expandedPaths.value.has(cleanRemotePath(path))
  }

  function isLoaded(path: string): boolean {
    return entriesByPath.value[cleanRemotePath(path)] !== undefined
  }

  function isLoading(path: string): boolean {
    return loadingPaths.value.has(cleanRemotePath(path))
  }

  function entriesOf(path: string): FileEntry[] {
    return entriesByPath.value[cleanRemotePath(path)] || []
  }

  async function loadChildren(path: string, force = false): Promise<FileEntry[]> {
    const clean = cleanRemotePath(path)
    if (!force && entriesByPath.value[clean] !== undefined) {
      return entriesByPath.value[clean]
    }
    if (loadingPaths.value.has(clean)) {
      for (let i = 0; i < 50; i++) {
        await new Promise((r) => setTimeout(r, 40))
        if (!loadingPaths.value.has(clean) && entriesByPath.value[clean] !== undefined) {
          return entriesByPath.value[clean]
        }
      }
    }

    const nextLoading = new Set(loadingPaths.value)
    nextLoading.add(clean)
    loadingPaths.value = nextLoading
    treeError.value = ''

    try {
      const raw = await window.LiteConnect.sftpReaddir(sessionId(), clean)
      const list = normalizeEntries(clean, raw)
      entriesByPath.value = { ...entriesByPath.value, [clean]: list }
      return list
    } catch (err: any) {
      treeError.value = err?.message || t('sftp.loadDirFailed')
      // Do NOT cache failures as empty success — that leaves path correct but tree blank forever.
      // Drop any prior cache for this path so the next force load retries.
      if (entriesByPath.value[clean] !== undefined) {
        const next = { ...entriesByPath.value }
        delete next[clean]
        entriesByPath.value = next
      }
      return []
    } finally {
      const done = new Set(loadingPaths.value)
      done.delete(clean)
      loadingPaths.value = done
    }
  }

  async function expand(path: string): Promise<void> {
    const clean = cleanRemotePath(path)
    const next = new Set(expandedPaths.value)
    next.add(clean)
    expandedPaths.value = next
    await loadChildren(clean)
  }

  async function toggleExpand(path: string): Promise<void> {
    const clean = cleanRemotePath(path)
    if (expandedPaths.value.has(clean)) {
      const next = new Set(expandedPaths.value)
      next.delete(clean)
      expandedPaths.value = next
      return
    }
    await expand(clean)
  }

  /**
   * Expand ancestors and load each segment.
   *
   * Important: if a parent listing is already cached but does not contain the
   * next path segment (common after `mkdir && cd` in the terminal), force a
   * readdir. Without this, the tree never renders the new directory row, so
   * refresh / sync / scroll-to-cwd all appear broken even though SFTP itself
   * can open the path.
   */
  async function followPath(targetPath: string, opts?: { forceAncestors?: boolean }): Promise<void> {
    const chain = ancestorPaths(targetPath)
    const next = new Set(expandedPaths.value)
    for (const p of chain) next.add(p)
    expandedPaths.value = next

    for (let i = 0; i < chain.length; i++) {
      const p = chain[i]
      const childPath = chain[i + 1]
      const cached = entriesByPath.value[p]
      let force = !!opts?.forceAncestors && i < chain.length - 1
      if (!force && childPath && cached) {
        const hasChild = cached.some((e) => cleanRemotePath(e.path) === childPath)
        if (!hasChild) force = true
      }
      await loadChildren(p, force)
    }

    // Belt-and-suspenders: if the leaf still is not listed under its parent
    // (server lag / race), inject a directory placeholder so the row exists
    // and scroll-to-path / highlight can work.
    if (chain.length >= 2) {
      const parent = chain[chain.length - 2]
      const leaf = chain[chain.length - 1]
      const kids = entriesByPath.value[parent] || []
      if (!kids.some((e) => cleanRemotePath(e.path) === leaf)) {
        const name = leaf === '/' ? '/' : leaf.slice(leaf.lastIndexOf('/') + 1)
        const placeholder: FileEntry = {
          name,
          path: leaf,
          isDirectory: true,
          isSymlink: false,
          size: 0,
          modifyTime: 0,
          permissions: 'drwxr-xr-x',
        }
        entriesByPath.value = {
          ...entriesByPath.value,
          [parent]: normalizeEntries(parent, [...kids, placeholder]),
        }
        if (entriesByPath.value[leaf] === undefined) {
          entriesByPath.value = { ...entriesByPath.value, [leaf]: [] }
        }
      }
    }
  }

  async function refreshNode(path: string): Promise<void> {
    await loadChildren(path, true)
  }

  /** Force-readdir path and all ancestors (toolbar refresh / locate cwd). */
  async function refreshPathChain(targetPath: string): Promise<void> {
    await followPath(targetPath, { forceAncestors: true })
    await loadChildren(cleanRemotePath(targetPath), true)
  }

  function reset(): void {
    entriesByPath.value = {}
    expandedPaths.value = new Set()
    loadingPaths.value = new Set()
    treeError.value = ''
  }

  /** 与 loadDirectory 结果合并，避免重复 readdir */
  function ingestListing(parentPath: string, entries: FileEntry[]): void {
    const clean = cleanRemotePath(parentPath)
    entriesByPath.value = {
      ...entriesByPath.value,
      [clean]: normalizeEntries(clean, entries),
    }
  }

  return {
    entriesByPath: entriesByPath as Ref<Record<string, FileEntry[]>>,
    expandedPaths: expandedPaths as Ref<Set<string>>,
    loadingPaths: loadingPaths as Ref<Set<string>>,
    treeError,
    isExpanded,
    isLoaded,
    isLoading,
    entriesOf,
    loadChildren,
    expand,
    toggleExpand,
    followPath,
    refreshNode,
    refreshPathChain,
    reset,
    ingestListing,
  }
}
