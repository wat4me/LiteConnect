import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

// --- Icons via pure PNG resize is hard without sharp; use PowerShell System.Drawing via child process ---
import { spawnSync } from 'child_process'

const iconPs = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = '${root.replace(/\\/g, '\\\\')}'
$srcPath = Join-Path $root 'build\\\\LiteConnect.png'
function New-ResizedPng([string]$source, [string]$dest, [int]$size) {
  $src = [System.Drawing.Image]::FromFile($source)
  try {
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    try {
      $bmp.SetResolution(96, 96)
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      try {
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $g.DrawImage($src, 0, 0, $size, $size)
      } finally { $g.Dispose() }
      $dir = Split-Path -Parent $dest
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
      $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally { $bmp.Dispose() }
  } finally { $src.Dispose() }
}
function New-IcoFromPngs([string[]]$pngPaths, [string]$icoPath) {
  $images = @()
  foreach ($p in $pngPaths) {
    $bytes = [System.IO.File]::ReadAllBytes($p)
    $img = [System.Drawing.Image]::FromFile($p)
    $images += [pscustomobject]@{ Bytes = $bytes; W = $img.Width; H = $img.Height }
    $img.Dispose()
  }
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter $ms
  $count = $images.Count
  $bw.Write([uint16]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]$count)
  $offset = 6 + (16 * $count)
  for ($i = 0; $i -lt $count; $i++) {
    $im = $images[$i]
    $w = if ($im.W -ge 256) { 0 } else { [byte]$im.W }
    $h = if ($im.H -ge 256) { 0 } else { [byte]$im.H }
    $bw.Write([byte]$w)
    $bw.Write([byte]$h)
    $bw.Write([byte]0)
    $bw.Write([byte]0)
    $bw.Write([uint16]1)
    $bw.Write([uint16]32)
    $bw.Write([uint32]$im.Bytes.Length)
    $bw.Write([uint32]$offset)
    $offset += $im.Bytes.Length
  }
  foreach ($im in $images) { $bw.Write($im.Bytes) }
  $bw.Flush()
  [System.IO.File]::WriteAllBytes($icoPath, $ms.ToArray())
  $bw.Dispose(); $ms.Dispose()
}
$tmp = Join-Path $env:TEMP 'LiteConnect-icons'
if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
New-Item -ItemType Directory -Path $tmp | Out-Null
$sizes = @(16, 32, 48, 64, 128, 256)
$pngs = @()
foreach ($s in $sizes) {
  $p = Join-Path $tmp "icon-$s.png"
  New-ResizedPng $srcPath $p $s
  $pngs += $p
}
New-IcoFromPngs $pngs (Join-Path $root 'build\\\\LiteConnect.ico')
New-IcoFromPngs @((Join-Path $tmp 'icon-16.png'), (Join-Path $tmp 'icon-32.png')) (Join-Path $root 'public\\\\LiteConnect.ico')
Copy-Item (Join-Path $tmp 'icon-256.png') (Join-Path $root 'public\\\\LiteConnect.png') -Force
Copy-Item (Join-Path $tmp 'icon-256.png') (Join-Path $root 'build\\\\LiteConnect-app.png') -Force
# dist for production window icon
if (-not (Test-Path (Join-Path $root 'dist'))) { New-Item -ItemType Directory -Path (Join-Path $root 'dist') | Out-Null }
Copy-Item (Join-Path $tmp 'icon-256.png') (Join-Path $root 'dist\\\\LiteConnect.png') -Force
Copy-Item (Join-Path $root 'public\\\\LiteConnect.ico') (Join-Path $root 'dist\\\\LiteConnect.ico') -Force
Write-Host 'icons ok'
`

const psFile = path.join(root, 'scripts', '_gen-icons.ps1')
fs.writeFileSync(psFile, iconPs, 'utf8')
const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psFile], {
  encoding: 'utf8',
})
console.log(r.stdout || '')
if (r.status !== 0) {
  console.error(r.stderr || r.stdout)
  process.exit(r.status || 1)
}

const SKIP_DIRS = new Set(['node_modules', 'release', 'dist-electron', 'dist', '.git'])
const EXTS = new Set(['.ts', '.vue', '.js', '.mjs', '.html', '.yml', '.yaml', '.md', '.json'])

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith('.') && ent.name !== '.github') continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue
      walk(p, out)
    } else {
      const ext = path.extname(ent.name).toLowerCase()
      if (!EXTS.has(ext)) continue
      if (ent.name.includes('brand-to-LiteConnect') || ent.name.includes('rename-to-liteconnect')) continue
      out.push(p)
    }
  }
  return out
}

const files = walk(root)
let count = 0
for (const file of files) {
  let text = fs.readFileSync(file, 'utf8')
  const orig = text

  // Preserve package/appId technical ids that should stay lowercase
  // Replace brand token liteConnect -> LiteConnect (word-ish)
  text = text.replace(/(?<![A-Za-z])liteConnect(?![A-Za-z])/g, 'LiteConnect')

  if (text !== orig) {
    fs.writeFileSync(file, text, 'utf8')
    count++
    console.log('updated:', path.relative(root, file))
  }
}
console.log('Updated files:', count)

// Update legacy migration map for both liteSSH and liteConnect keys
const migratePath = path.join(root, 'src', 'utils', 'legacyStorageMigrate.ts')
if (fs.existsSync(migratePath)) {
  let m = fs.readFileSync(migratePath, 'utf8')
  m = `/** Migrate localStorage keys from liteSSH/liteConnect → LiteConnect (once). */

const KEY_MAP: Array<[legacy: string, next: string]> = [
  ['liteSSH.locale', 'LiteConnect.locale'],
  ['liteConnect.locale', 'LiteConnect.locale'],
  ['liteSSH.batchCommandHistory', 'LiteConnect.batchCommandHistory'],
  ['liteConnect.batchCommandHistory', 'LiteConnect.batchCommandHistory'],
  ['liteSSH.db.savedQueries', 'LiteConnect.db.savedQueries'],
  ['liteConnect.db.savedQueries', 'LiteConnect.db.savedQueries'],
  ['liteSSH.db.showSystemDbs', 'LiteConnect.db.showSystemDbs'],
  ['liteConnect.db.showSystemDbs', 'LiteConnect.db.showSystemDbs'],
  ['liteSSH.dbQueryDrafts.v1', 'LiteConnect.dbQueryDrafts.v1'],
  ['liteConnect.dbQueryDrafts.v1', 'LiteConnect.dbQueryDrafts.v1'],
  ['liteSSH.dbQueryHistory.v1', 'LiteConnect.dbQueryHistory.v1'],
  ['liteConnect.dbQueryHistory.v1', 'LiteConnect.dbQueryHistory.v1'],
  ['liteSSH.onboardingTips.v1', 'LiteConnect.onboardingTips.v1'],
  ['liteConnect.onboardingTips.v1', 'LiteConnect.onboardingTips.v1'],
  ['liteSSH.splitDragTipSeen', 'LiteConnect.splitDragTipSeen'],
  ['liteConnect.splitDragTipSeen', 'LiteConnect.splitDragTipSeen'],
  ['litessh-theme', 'liteconnect-theme'],
  ['litessh-custom-colors', 'liteconnect-custom-colors'],
  ['litessh-sftp-sidebar-width', 'liteconnect-sftp-sidebar-width'],
]

export function migrateLegacyLocalStorage(): void {
  try {
    const storage = globalThis.localStorage
    if (!storage) return
    for (const [legacy, next] of KEY_MAP) {
      if (legacy === next) continue
      if (storage.getItem(next) != null) {
        storage.removeItem(legacy)
        continue
      }
      const value = storage.getItem(legacy)
      if (value == null) continue
      storage.setItem(next, value)
      storage.removeItem(legacy)
    }
  } catch {
    // Storage can be unavailable in restricted contexts.
  }
}

export function getDataTransferConnId(dt: DataTransfer | null | undefined): string {
  if (!dt) return ''
  return (
    dt.getData('application/x-lite-connect-conn') ||
    dt.getData('application/x-lite-ssh-conn') ||
    ''
  )
}

export function dataTransferHasConn(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false
  const types = Array.from(dt.types || [])
  return (
    types.includes('application/x-lite-connect-conn') ||
    types.includes('application/x-lite-ssh-conn')
  )
}
`
  fs.writeFileSync(migratePath, m, 'utf8')
  console.log('rewrote legacyStorageMigrate.ts')
}

// Fix electron-builder icon path & product strings if needed
const builder = path.join(root, 'electron-builder.yml')
let by = fs.readFileSync(builder, 'utf8')
by = by
  .replace(/icon: build\/.*/g, 'icon: build/LiteConnect.ico')
  .replace(/productName: .*/g, 'productName: LiteConnect')
  .replace(/shortcutName: .*/g, 'shortcutName: LiteConnect')
  .replace(/uninstallDisplayName: .*/g, 'uninstallDisplayName: LiteConnect')
fs.writeFileSync(builder, by, 'utf8')

// createWindow icon paths
const cw = path.join(root, 'electron', 'window', 'createWindow.ts')
let cwt = fs.readFileSync(cw, 'utf8')
cwt = cwt.replace(/liteConnect\.png/g, 'LiteConnect.png').replace(/LiteConnect\.png/g, 'LiteConnect.png')
// prefer app 256 for window if we set path to LiteConnect-app.png for perf? keep LiteConnect.png (source high-res ok)
// Actually build/LiteConnect.png is full source - for window use LiteConnect-app.png
cwt = cwt.replace(
  /icon: join\(__dirname, process\.env\.VITE_DEV_SERVER_URL \? '[^']+' : '[^']+'\)/,
  "icon: join(__dirname, process.env.VITE_DEV_SERVER_URL ? '../build/LiteConnect-app.png' : '../dist/LiteConnect.png')",
)
fs.writeFileSync(cw, cwt, 'utf8')

// index.html
const ih = path.join(root, 'index.html')
let iht = fs.readFileSync(ih, 'utf8')
iht = iht.replace(/liteConnect\.(ico|png)/g, 'LiteConnect.$1').replace(/\.\/LiteConnect\.ico/, './LiteConnect.ico')
iht = iht.replace(/<title>.*?<\/title>/, '<title>LiteConnect</title>')
fs.writeFileSync(ih, iht, 'utf8')

// Remove obsolete camelCase assets (Windows FS case-insensitive: careful)
const removeIfExists = [
  path.join(root, 'build', 'liteSSH.ico'),
  path.join(root, 'build', 'liteSSH.png'),
  path.join(root, 'public', 'liteSSH.ico'),
  path.join(root, 'public', 'liteSSH.png'),
]
for (const p of removeIfExists) {
  try {
    if (fs.existsSync(p) && path.basename(p).includes('SSH')) fs.unlinkSync(p)
  } catch {}
}

console.log('done')
