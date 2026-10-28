import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const base = join(root, 'build/third-party')
const installer = join(base, 'vcxsrv-64.1.20.14.0.installer.exe')
const installerHash = '7a5cd7d9d0ac982f09c8a93051fc48ab072fcc4b52237d1b91494363b9dad27e'
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const runtime = join(base, 'vcxsrv-runtime')
const stamp = join(runtime, '.prepared.json')

// Only the Windows artifact contains this runtime. Never execute an installer.
export function prepareX11Runtime({ verifyAll = false } = {}) {
  if (process.platform !== 'win32') return
  if (hash(installer) !== installerHash) throw new Error('VcXsrv installer checksum mismatch')
  if (existsSync(stamp)) {
    const files = JSON.parse(readFileSync(stamp, 'utf8'))
    const checkedFiles = verifyAll ? files.files : files.files.filter(([path]) => !/[\\/]/.test(path))
    if (files.installer === installerHash && checkedFiles.length && checkedFiles.every(([path, digest]) =>
      existsSync(join(runtime, path)) && hash(join(runtime, path)) === digest)) return
  }
  const cache = join(root, 'node_modules/.cache/litessh/x11-extractor')
  mkdirSync(cache, { recursive: true })
  // Full 7-Zip is needed: the 7za used by electron-builder cannot unpack NSIS.
  // This pinned extractor is build tooling only, never distributed with the app.
  const archive = join(cache, '7z2301-x64.exe')
  const toolHash = '26cb6e9f56333682122fafe79dbcdfd51e9f47cc7217dccd29ac6fc33b5598cd'
  if (!existsSync(archive)) execFileSync('curl.exe', ['-fL', '--retry', '2', '--max-time', '120',
    'https://www.7-zip.org/a/7z2301-x64.exe', '-o', archive], { stdio: 'inherit', windowsHide: true })
  if (hash(archive) !== toolHash) throw new Error('7-Zip extractor checksum mismatch')
  execFileSync(join(root, 'node_modules/7zip-bin/win/x64/7za.exe'), ['x', archive, `-o${cache}`, '-y'], { windowsHide: true, stdio: 'pipe' })
  mkdirSync(runtime, { recursive: true })
  execFileSync(join(cache, '7z.exe'), ['x', installer, `-o${runtime}`, '-x!$PLUGINSDIR', '-x!uninstall.exe', '-y'], { windowsHide: true, stdio: 'pipe' })
  // Preserve every dependency, font, keyboard layout and license from upstream.
  const files = execFileSync(join(cache, '7z.exe'), ['l', '-slt', installer], { encoding: 'utf8', windowsHide: true })
    .split(/\r?\n/).filter(line => line.startsWith('Path = ')).map(line => line.slice(7))
    .filter(path => path !== installer && existsSync(join(runtime, path)))
  writeFileSync(stamp, JSON.stringify({ installer: installerHash, files: files.filter(path => statSync(join(runtime, path)).isFile()).map(path => [path, hash(join(runtime, path))]) }))
  console.log('Prepared portable VcXsrv runtime (no system installation).')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) prepareX11Runtime()
