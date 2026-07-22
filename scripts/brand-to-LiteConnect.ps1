$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'D:\project\liteSSH'
$root = (Get-Location).Path

# --- Generate icons from build/LiteConnect.png ---
Add-Type -AssemblyName System.Drawing
$srcPath = Join-Path $root 'build\LiteConnect.png'
if (-not (Test-Path -LiteralPath $srcPath)) { throw "Missing $srcPath" }

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
  # Build multi-size ICO manually
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
  # ICONDIR
  $bw.Write([uint16]0)      # reserved
  $bw.Write([uint16]1)      # type icon
  $bw.Write([uint16]$count) # count
  $offset = 6 + (16 * $count)
  for ($i = 0; $i -lt $count; $i++) {
    $im = $images[$i]
    $w = if ($im.W -ge 256) { 0 } else { [byte]$im.W }
    $h = if ($im.H -ge 256) { 0 } else { [byte]$im.H }
    $bw.Write([byte]$w)
    $bw.Write([byte]$h)
    $bw.Write([byte]0) # colors
    $bw.Write([byte]0) # reserved
    $bw.Write([uint16]1) # planes
    $bw.Write([uint16]32) # bitcount
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

# Main app PNG (256) + ICO multi-size
$png256 = Join-Path $tmp 'icon-256.png'
Copy-Item -LiteralPath $srcPath -Destination (Join-Path $root 'build\LiteConnect.png') -Force
# Also keep a clean 256 for window icon if source is huge — use full source is fine
New-ResizedPng $srcPath (Join-Path $root 'build\LiteConnect-256.png') 256
# Prefer 256 png as runtime window icon path uses LiteConnect.png; keep original high-res as source
# electron-builder wants .ico
New-IcoFromPngs $pngs (Join-Path $root 'build\LiteConnect.ico')
# public favicon: multi-size ico + 32 png
New-IcoFromPngs @((Join-Path $tmp 'icon-16.png'), (Join-Path $tmp 'icon-32.png')) (Join-Path $root 'public\LiteConnect.ico')
Copy-Item -LiteralPath (Join-Path $tmp 'icon-32.png') -Destination (Join-Path $root 'public\LiteConnect.png') -Force
# window uses build png in dev; copy high-res or 256
Copy-Item -LiteralPath (Join-Path $tmp 'icon-256.png') -Destination (Join-Path $root 'build\LiteConnect-window.png') -Force
# For createWindow: use 256 png named LiteConnect.png in build? Keep high-res source name LiteConnect.png
# Actually createWindow points to build/LiteConnect.png - high-res is OK for Electron
# dist copies via vite public? public assets go to dist; also builder uses build/

# Clean old camelCase assets if different files
foreach ($old in @(
  'build\liteConnect.ico','build\liteConnect.png','build\liteSSH.ico','build\liteSSH.png',
  'public\liteConnect.ico','public\liteConnect.png','public\liteSSH.ico','public\liteSSH.png',
  'dist\liteConnect.ico','dist\liteConnect.png','dist\liteSSH.ico','dist\liteSSH.png'
)) {
  if (Test-Path -LiteralPath $old) {
    # only remove if not same as new path (Windows case-insensitive)
    Remove-Item -LiteralPath $old -Force -ErrorAction SilentlyContinue
  }
}

# Ensure public high-quality: 256 is fine for favicon png; for dist window icon use 256
Copy-Item -LiteralPath (Join-Path $tmp 'icon-256.png') -Destination (Join-Path $root 'public\LiteConnect-256.png') -Force
# rebuild LiteConnect.png in public as 256 for lighter web assets? User put logo in build; keep public png as 256
Copy-Item -LiteralPath (Join-Path $tmp 'icon-256.png') -Destination (Join-Path $root 'public\LiteConnect.png') -Force
# Keep build/LiteConnect.png as original full-res (already there from user)
# Window icon path: use 256 for performance
Copy-Item -LiteralPath (Join-Path $tmp 'icon-256.png') -Destination (Join-Path $root 'build\LiteConnect-app.png') -Force

Write-Host 'Icons generated.'

# --- Brand rename liteConnect -> LiteConnect (display/API) carefully ---
$files = Get-ChildItem -Recurse -File | Where-Object {
  $p = $_.FullName
  if ($p -match '\\node_modules\\|\\release\\|\\dist-electron\\|\\dist\\') { return $false }
  if ($p -match 'rename-to-liteconnect|brand-to-LiteConnect') { return $false }
  $ext = $_.Extension.ToLowerInvariant()
  return $ext -in @('.ts','.vue','.js','.mjs','.html','.yml','.yaml','.md','.json')
}

$count = 0
foreach ($f in $files) {
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  if ($bytes.Length -eq 0) { continue }
  $utf8 = New-Object System.Text.UTF8Encoding $false
  $offset = 0
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) { $offset = 3 }
  $text = $utf8.GetString($bytes, $offset, $bytes.Length - $offset)
  $orig = $text

  # file path references for assets
  $text = $text.Replace('liteConnect.ico', 'LiteConnect.ico')
  $text = $text.Replace('liteConnect.png', 'LiteConnect.png')
  $text = $text.Replace('build/liteConnect', 'build/LiteConnect')
  $text = $text.Replace('./liteConnect', './LiteConnect')
  $text = $text.Replace('../build/LiteConnect', '../build/LiteConnect') # no-op safe
  $text = $text.Replace('../dist/liteConnect', '../dist/LiteConnect')
  $text = $text.Replace('../dist/LiteConnect', '../dist/LiteConnect')

  # product / UI strings (not package name lite-connect, not appId com.liteconnect)
  $text = $text.Replace('productName: liteConnect', 'productName: LiteConnect')
  $text = $text.Replace('shortcutName: liteConnect', 'shortcutName: LiteConnect')
  $text = $text.Replace('uninstallDisplayName: liteConnect', 'uninstallDisplayName: LiteConnect')
  $text = $text.Replace('"author": "liteConnect"', '"author": "LiteConnect"')
  $text = $text.Replace("title: 'liteConnect'", "title: 'LiteConnect'")
  $text = $text.Replace('<title>liteConnect</title>', '<title>LiteConnect</title>')
  $text = $text.Replace('# liteConnect', '# LiteConnect')
  $text = $text.Replace('liteConnect 是', 'LiteConnect 是')
  $text = $text.Replace('liteConnect/', 'LiteConnect/')
  $text = $text.Replace('%APPDATA%\liteConnect\', '%APPDATA%\LiteConnect\')
  $text = $text.Replace("%APPDATA%\\liteConnect\\", "%APPDATA%\\LiteConnect\\")
  $text = $text.Replace('name: ''liteConnect''', 'name: ''LiteConnect''')
  $text = $text.Replace("homeAria: 'liteConnect 首页'", "homeAria: 'LiteConnect 首页'")
  $text = $text.Replace('当前 liteConnect', '当前 LiteConnect')
  $text = $text.Replace('liteConnect 不内嵌', 'LiteConnect 不内嵌')
  $text = $text.Replace('安装 liteConnect 附带', '安装 LiteConnect 附带')
  $text = $text.Replace('欢迎使用 liteConnect', '欢迎使用 LiteConnect')
  $text = $text.Replace('你是 liteConnect 内置', '你是 LiteConnect 内置')
  $text = $text.Replace('>liteConnect</span>', '>LiteConnect</span>')
  $text = $text.Replace('[liteConnect]', '[LiteConnect]')
  $text = $text.Replace('liteConnect-test-userdata', 'LiteConnect-test-userdata')
  $text = $text.Replace('liteConnect-command-snippets', 'LiteConnect-command-snippets')
  $text = $text.Replace('liteConnect-db-connections.json', 'LiteConnect-db-connections.json')
  $text = $text.Replace('liteConnect-connections.json', 'LiteConnect-connections.json')
  $text = $text.Replace('liteConnect-command-snippets.json', 'LiteConnect-command-snippets.json')

  # bridge API window.liteConnect -> window.LiteConnect
  $text = $text.Replace('window.liteConnect', 'window.LiteConnect')
  $text = $text.Replace("exposeInMainWorld('liteConnect'", "exposeInMainWorld('LiteConnect'")
  $text = $text.Replace('    liteConnect: {', '    LiteConnect: {')
  $text = $text.Replace('      liteConnect: {', '      LiteConnect: {')
  $text = $text.Replace('(window as any).liteConnect', '(window as any).LiteConnect')
  $text = $text.Replace('globalThis as any).window.liteConnect', 'globalThis as any).window.LiteConnect')
  $text = $text.Replace('window.LiteConnect?.', 'window.LiteConnect?.') # no-op

  # localStorage display-brand keys liteConnect. -> LiteConnect.
  $text = $text.Replace("'liteConnect.", "'LiteConnect.")
  $text = $text.Replace('"liteConnect.', '"LiteConnect.')
  $text = $text.Replace('liteConnect.locale', 'LiteConnect.locale')
  $text = $text.Replace('liteConnect.batchCommandHistory', 'LiteConnect.batchCommandHistory')
  $text = $text.Replace('liteConnect.db.', 'LiteConnect.db.')
  $text = $text.Replace('liteConnect.dbQueryDrafts', 'LiteConnect.dbQueryDrafts')
  $text = $text.Replace('liteConnect.dbQueryHistory', 'LiteConnect.dbQueryHistory')
  $text = $text.Replace('liteConnect.onboardingTips', 'LiteConnect.onboardingTips')
  $text = $text.Replace('liteConnect.splitDragTipSeen', 'LiteConnect.splitDragTipSeen')

  # remaining bare liteConnect word in Chinese/docs (careful: don't touch com.liteconnect or lite-connect)
  # Replace remaining liteConnect that is not part of liteconnect lower
  $text = [regex]::Replace($text, '(?<![a-zA-Z])liteConnect(?![a-zA-Z])', 'LiteConnect')

  if ($text -ne $orig) {
    [System.IO.File]::WriteAllText($f.FullName, $text, $utf8)
    $count++
    Write-Host ("updated: " + $f.FullName.Substring($root.Length + 1))
  }
}
Write-Host "Updated files: $count"

Write-Host '--- remaining liteConnect ---'
Get-ChildItem -Recurse -File | Where-Object {
  $p = $_.FullName
  if ($p -match '\\node_modules\\|\\release\\|\\dist-electron\\|\\dist\\|scripts\\') { return $false }
  $ext = $_.Extension.ToLowerInvariant()
  return $ext -in @('.ts','.vue','.js','.mjs','.html','.yml','.yaml','.md','.json')
} | ForEach-Object {
  Select-String -LiteralPath $_.FullName -Pattern 'liteConnect' -ErrorAction SilentlyContinue
} | ForEach-Object { "$($_.Filename):$($_.LineNumber):$($_.Line.Trim())" }
