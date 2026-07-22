import { ref, type Ref } from 'vue'
import { t } from '../i18n'
import type { FileEntry } from '../env.d.ts'

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

  async function followPath(targetPath: string): Promise<void> {
    const chain = ancestorPaths(targetPath)
    const next = new Set(expandedPaths.value)
    for (const p of chain) next.add(p)
    expandedPaths.value = next
    for (const p of chain) {
      await loadChildren(p)
    }
  }

  async function refreshNode(path: string): Promise<void> {
    await loadChildren(path, true)
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
    reset,
    ingestListing,
  }
}
