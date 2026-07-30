import * as fs from 'fs'
import * as path from 'path'

/** Default concurrent file transfers for directory upload/download (SSH-friendly). */
export const DEFAULT_DIR_TRANSFER_CONCURRENCY = 3

/** Concurrent directory scan workers during local walk. */
export const DEFAULT_WALK_CONCURRENCY = 8

/** Yield to the event loop every N directory entries processed. */
export const WALK_YIELD_EVERY = 64

export type SymlinkPolicy = 'skip'

export type DirFailPolicy = 'continue' | 'stop'

export interface LocalWalkFile {
  localPath: string
  /** POSIX-style path relative to walk root (no leading slash). */
  relativePosix: string
  size: number
}

export interface LocalWalkDir {
  localPath: string
  relativePosix: string
}

export interface WalkLocalResult {
  files: LocalWalkFile[]
  dirs: LocalWalkDir[]
  totalSize: number
}

export interface WalkLocalOptions {
  /** Bounded concurrent readdir/lstat workers. Default DEFAULT_WALK_CONCURRENCY. */
  concurrency?: number
  /** Cooperative cancel. */
  isCancelled?: () => boolean
  /**
   * Symlink policy. Default `skip`: never follow symlinks (no cycles / no escape).
   * Directory and file symlinks are omitted from the result.
   */
  symlinkPolicy?: SymlinkPolicy
  /** Yield to event loop every N processed dir entries. */
  yieldEvery?: number
}

export class TransferCancelledError extends Error {
  constructor(message = 'Transfer cancelled') {
    super(message)
    this.name = 'TransferCancelledError'
  }
}

function joinPosix(parent: string, name: string): string {
  if (!parent) return name
  return `${parent}/${name}`
}

/**
 * Async local tree walk with bounded concurrency, cancel support, and safe symlink handling.
 * Uses lstat: symlinks are never followed (policy `skip`).
 */
export async function walkLocalTree(
  rootDir: string,
  options?: WalkLocalOptions,
): Promise<WalkLocalResult> {
  const concurrency = Math.max(1, options?.concurrency ?? DEFAULT_WALK_CONCURRENCY)
  const isCancelled = options?.isCancelled ?? (() => false)
  const yieldEvery = Math.max(1, options?.yieldEvery ?? WALK_YIELD_EVERY)
  // symlinkPolicy reserved; only 'skip' is implemented and is the default.

  const root = path.resolve(rootDir)
  const files: LocalWalkFile[] = []
  const dirs: LocalWalkDir[] = []
  let totalSize = 0
  let processed = 0

  // BFS queue of directories to visit (absolute path + relative posix)
  type Q = { abs: string; rel: string }
  const queue: Q[] = [{ abs: root, rel: '' }]
  // Realpath of visited directories when resolvable (extra cycle guard if policy changes)
  const visitedReal = new Set<string>()

  try {
    const rootReal = await fs.promises.realpath(root)
    visitedReal.add(rootReal)
  } catch {
    visitedReal.add(root)
  }

  let active = 0
  let queueIndex = 0
  let walkError: Error | null = null

  const throwIfCancelled = () => {
    if (isCancelled()) throw new TransferCancelledError()
  }

  const maybeYield = async () => {
    processed++
    if (processed % yieldEvery === 0) {
      await new Promise<void>((r) => setImmediate(r))
    }
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const settleOk = () => {
      if (settled) return
      settled = true
      resolve()
    }
    const settleErr = (err: Error) => {
      if (settled) return
      settled = true
      reject(err)
    }

    const pump = () => {
      if (settled) return
      if (walkError) {
        settleErr(walkError)
        return
      }
      if (isCancelled()) {
        settleErr(new TransferCancelledError())
        return
      }

      while (active < concurrency && queueIndex < queue.length) {
        const item = queue[queueIndex++]
        active++
        void processDir(item)
          .catch((err: Error) => {
            if (!walkError) walkError = err
          })
          .finally(() => {
            active--
            if (walkError) {
              settleErr(walkError)
              return
            }
            if (active === 0 && queueIndex >= queue.length) {
              settleOk()
              return
            }
            pump()
          })
      }

      if (active === 0 && queueIndex >= queue.length) {
        settleOk()
      }
    }

    const processDir = async (item: Q) => {
      throwIfCancelled()
      await maybeYield()

      let names: string[]
      try {
        names = await fs.promises.readdir(item.abs)
      } catch (err: any) {
        // Unreadable directory: skip rather than abort whole tree
        return
      }

      for (const name of names) {
        throwIfCancelled()
        const childAbs = path.join(item.abs, name)
        const childRel = joinPosix(item.rel, name)

        let st: fs.Stats
        try {
          st = await fs.promises.lstat(childAbs)
        } catch {
          continue
        }

        if (st.isSymbolicLink()) {
          // Default policy: skip all symlinks (no follow, no cycles, no escape)
          continue
        }

        if (st.isDirectory()) {
          let real = childAbs
          try {
            real = await fs.promises.realpath(childAbs)
          } catch {
            // keep childAbs
          }
          if (visitedReal.has(real)) {
            continue
          }
          visitedReal.add(real)
          dirs.push({ localPath: childAbs, relativePosix: childRel })
          queue.push({ abs: childAbs, rel: childRel })
        } else if (st.isFile()) {
          files.push({
            localPath: childAbs,
            relativePosix: childRel,
            size: st.size,
          })
          totalSize += st.size
        }
        // ignore sockets, fifos, devices
      }
    }

    pump()
  })

  throwIfCancelled()
  return { files, dirs, totalSize }
}

export interface RunPoolOptions {
  concurrency?: number
  isCancelled?: () => boolean
  /** When true (default), first worker error stops scheduling new work and rejects. */
  stopOnError?: boolean
}

export interface RunPoolResult {
  errors: Array<{ index: number; error: Error }>
  completed: number
  failed: number
}

/**
 * Bounded worker pool over a fixed item list (backpressure: at most `concurrency` in flight).
 */
export async function runPool<T>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<void>,
  options?: RunPoolOptions,
): Promise<RunPoolResult> {
  const concurrency = Math.max(1, options?.concurrency ?? DEFAULT_DIR_TRANSFER_CONCURRENCY)
  const isCancelled = options?.isCancelled ?? (() => false)
  const stopOnError = options?.stopOnError !== false

  const errors: Array<{ index: number; error: Error }> = []
  let completed = 0
  let failed = 0
  let nextIndex = 0
  let active = 0
  let stopped = false
  let cancelError: Error | null = null

  if (items.length === 0) {
    return { errors, completed: 0, failed: 0 }
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      if (cancelError) {
        reject(cancelError)
        return
      }
      if (stopOnError && errors.length > 0) {
        reject(errors[0].error)
        return
      }
      resolve()
    }

    const pump = () => {
      if (settled) return
      if (stopped) {
        if (active === 0) finish()
        return
      }
      if (isCancelled()) {
        stopped = true
        cancelError = new TransferCancelledError()
        if (active === 0) finish()
        return
      }

      while (active < concurrency && nextIndex < items.length && !stopped) {
        const index = nextIndex++
        const item = items[index]
        active++
        void worker(item, index)
          .then(() => {
            completed++
          })
          .catch((err: Error) => {
            failed++
            const e = err instanceof Error ? err : new Error(String(err))
            errors.push({ index, error: e })
            if (stopOnError) {
              stopped = true
            }
          })
          .finally(() => {
            active--
            if (stopped || nextIndex >= items.length) {
              if (active === 0) finish()
              else if (!stopped) pump()
            } else {
              pump()
            }
          })
      }

      if (active === 0 && (stopped || nextIndex >= items.length)) {
        finish()
      }
    }

    pump()
  })

  return { errors, completed, failed }
}

/**
 * Monotonic byte progress aggregator for concurrent file transfers.
 * Reported transferred never decreases and never exceeds total.
 */
export class MonotonicByteProgress {
  private transferred = 0
  private reported = 0

  constructor(public total: number) {
    if (this.total < 0) this.total = 0
  }

  /** Add a non-negative delta from a single file's progress stream. */
  add(delta: number): number {
    if (!(delta > 0)) return this.reported
    this.transferred += delta
    const next = this.total > 0 ? Math.min(this.transferred, this.total) : this.transferred
    if (next > this.reported) this.reported = next
    return this.reported
  }

  /** Force report to total (successful completion). Empty total stays 0/0. */
  complete(): number {
    this.transferred = this.total
    this.reported = this.total
    return this.reported
  }

  get current(): number {
    return this.reported
  }
}

export interface DirTransferProgressStats {
  completedFiles: number
  failedFiles: number
  totalFiles: number
}

export type DirProgressCallback = (
  transferred: number,
  total: number,
  stats?: DirTransferProgressStats,
) => void

/** Join remote parent with a POSIX relative path (segments separated by /). */
export function joinRemoteRelative(remoteRoot: string, relativePosix: string): string {
  if (!relativePosix) return remoteRoot
  const parts = relativePosix.split('/').filter(Boolean)
  let cur = remoteRoot
  for (const p of parts) {
    cur = cur === '/' ? `/${p}` : `${cur}/${p}`
  }
  return cur
}

/** Redact home/user segments from error messages for IPC. */
export function sanitizeTransferError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err)
  return raw
    .replace(/[A-Za-z]:\\Users\\[^\\]+/gi, '%USERPROFILE%')
    .replace(/\/home\/[^/\s]+/g, '/home/*')
    .replace(/\\Users\\[^\\]+/gi, '\\Users\\*')
}
