$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = 'D:\project\liteSSH'
$srcPath = Join-Path $root 'build\LiteConnect.png'

function New-PaddedSquarePng([string]$source, [string]$dest, [int]$size) {
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
        $scale = [Math]::Min($size / $src.Width, $size / $src.Height)
        $dw = [int][Math]::Round($src.Width * $scale)
        $dh = [int][Math]::Round($src.Height * $scale)
        $dx = [int](($size - $dw) / 2)
        $dy = [int](($size - $dh) / 2)
        $g.DrawImage($src, $dx, $dy, $dw, $dh)
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
  New-PaddedSquarePng $srcPath $p $s
  $pngs += $p
}
New-IcoFromPngs $pngs (Join-Path $root 'build\LiteConnect.ico')
New-IcoFromPngs @((Join-Path $tmp 'icon-16.png'), (Join-Path $tmp 'icon-32.png')) (Join-Path $root 'public\LiteConnect.ico')
Copy-Item (Join-Path $tmp 'icon-256.png') (Join-Path $root 'public\LiteConnect.png') -Force
Copy-Item (Join-Path $tmp 'icon-256.png') (Join-Path $root 'build\LiteConnect-app.png') -Force
if (-not (Test-Path (Join-Path $root 'dist'))) { New-Item -ItemType Directory -Path (Join-Path $root 'dist') | Out-Null }
Copy-Item (Join-Path $tmp 'icon-256.png') (Join-Path $root 'dist\LiteConnect.png') -Force
Copy-Item (Join-Path $root 'public\LiteConnect.ico') (Join-Path $root 'dist\LiteConnect.ico') -Force
Write-Host 'icons ok (padded, no stretch)'
