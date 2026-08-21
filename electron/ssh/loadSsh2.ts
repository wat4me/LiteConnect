/**
 * Lazy loader for the ssh2 native addon.
 * Call only from connect / test / diagnose / DB tunnel paths — never at module eval.
 *
 * Uses createRequire so Vitest/Vite do not treat ssh2 as a static graph edge
 * (dynamic `import('ssh2')` still pulled the native module into SSHManager tests).
 */
import { createRequire } from 'node:module'

const nodeRequire = createRequire(import.meta.url)

let cached: Promise<typeof import('ssh2')> | null = null

export function loadSsh2(): Promise<typeof import('ssh2')> {
  if (!cached) {
    cached = Promise.resolve().then(() => nodeRequire('ssh2') as typeof import('ssh2'))
  }
  return cached
}
