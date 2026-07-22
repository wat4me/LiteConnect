import { existsSync } from 'fs'
import { join } from 'path'

export type ConflictStrategy = 'overwrite' | 'skip' | 'rename'

export function getUniqueLocalPath(dir: string, filename: string): string {
  let filePath = join(dir, filename)
  if (!existsSync(filePath)) return filePath

  const ext = filename.includes('.') ? '.' + filename.split('.').pop() : ''
  const baseName = ext ? filename.slice(0, -ext.length) : filename
  let counter = 1
  while (existsSync(join(dir, `${baseName} (${counter})${ext}`))) {
    counter++
  }
  return join(dir, `${baseName} (${counter})${ext}`)
}

/** Resolve local destination path given conflict strategy. Returns null when skip. */
export function resolveLocalConflictPath(
  dir: string,
  filename: string,
  strategy: ConflictStrategy,
): string | null {
  const target = join(dir, filename)
  if (!existsSync(target)) return target
  if (strategy === 'overwrite') return target
  if (strategy === 'skip') return null
  return getUniqueLocalPath(dir, filename)
}

/** Generate unique remote file name (basename only) when target exists. */
export function nextRemoteName(existingNames: Set<string>, filename: string): string {
  if (!existingNames.has(filename)) return filename
  const ext = filename.includes('.') ? '.' + filename.split('.').pop() : ''
  const baseName = ext ? filename.slice(0, -ext.length) : filename
  let counter = 1
  while (existingNames.has(`${baseName} (${counter})${ext}`)) {
    counter++
  }
  return `${baseName} (${counter})${ext}`
}

export function joinRemote(parent: string, name: string): string {
  if (!parent || parent === '/') return `/${name}`
  return parent.endsWith('/') ? `${parent}${name}` : `${parent}/${name}`
}

export function remoteDirname(remotePath: string): string {
  const cleaned = remotePath.replace(/\/+$/, '') || '/'
  const idx = cleaned.lastIndexOf('/')
  if (idx <= 0) return '/'
  return cleaned.slice(0, idx) || '/'
}

export function remoteBasename(remotePath: string): string {
  const cleaned = remotePath.replace(/\/+$/, '') || '/'
  const idx = cleaned.lastIndexOf('/')
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned
}

/** Detect archive type from filename for remote extract. */
export type ArchiveKind = 'tar' | 'targz' | 'tarbz2' | 'tarxz' | 'zip' | 'gz' | '7z'

export function detectArchiveKind(fileName: string): ArchiveKind | null {
  const lower = fileName.toLowerCase()
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'targz'
  if (lower.endsWith('.tar.bz2') || lower.endsWith('.tbz2') || lower.endsWith('.tbz')) return 'tarbz2'
  if (lower.endsWith('.tar.xz') || lower.endsWith('.txz')) return 'tarxz'
  if (lower.endsWith('.tar')) return 'tar'
  if (lower.endsWith('.zip')) return 'zip'
  if (lower.endsWith('.7z')) return '7z'
  if (lower.endsWith('.gz') && !lower.endsWith('.tar.gz')) return 'gz'
  return null
}

export function buildExtractCommand(remotePath: string, kind: ArchiveKind): string {
  // Paths are shell-quoted by caller via shellQuote in manager
  switch (kind) {
    case 'targz':
      return `tar -xzf`
    case 'tarbz2':
      return `tar -xjf`
    case 'tarxz':
      return `tar -xJf`
    case 'tar':
      return `tar -xf`
    case 'zip':
      return `unzip -o`
    case '7z':
      return `7z x -y`
    case 'gz':
      return `gunzip -k -f`
    default:
      return `tar -xf`
  }
}
