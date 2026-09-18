import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

/**
 * The bash grammar travels with the app: it is copied next to main.js so
 * electron/mcp/bashParser can find it inside the packaged asar without having
 * to know about the repository layout.
 *
 * In `vite dev` this copy does not run; bashParser falls back to resolving the
 * file from the repository root, which is the working directory there.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'shared', 'mcp', 'vendor', 'tree-sitter-bash.wasm')
const distDir = join(root, 'dist-electron')
const target = join(distDir, 'tree-sitter-bash.wasm')

if (!existsSync(source)) {
  console.error(`[copy-bash-wasm] missing source: ${source}`)
  process.exit(1)
}
if (!existsSync(distDir)) {
  console.error('[copy-bash-wasm] dist-electron does not exist; run the vite build first')
  process.exit(1)
}

mkdirSync(distDir, { recursive: true })
copyFileSync(source, target)
console.log(`[copy-bash-wasm] ${source} -> ${target}`)
