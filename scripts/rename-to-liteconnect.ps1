$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath 'D:\project\liteSSH'

# Icon assets
$iconPairs = @(
  @('build\liteSSH.ico', 'build\liteConnect.ico'),
  @('build\liteSSH.png', 'build\liteConnect.png'),
  @('public\liteSSH.ico', 'public\liteConnect.ico'),
  @('public\liteSSH.png', 'public\liteConnect.png'),
  @('dist\liteSSH.ico', 'dist\liteConnect.ico'),
  @('dist\liteSSH.png', 'dist\liteConnect.png')
)
foreach ($pair in $iconPairs) {
  if (Test-Path -LiteralPath $pair[0]) {
    Copy-Item -LiteralPath $pair[0] -Destination $pair[1] -Force
  }
}

$root = (Get-Location).Path
$files = Get-ChildItem -Recurse -File | Where-Object {
  $p = $_.FullName
  if ($p -match '\\node_modules\\|\\release\\|\\dist-electron\\|\\package-lock\.json') { return $false }
  if ($p -match '\\dist\\' -and $_.Name -ne 'index.html') { return $false }
  $ext = $_.Extension.ToLowerInvariant()
  return $ext -in @('.ts', '.vue', '.js', '.mjs', '.html', '.yml', '.yaml', '.md', '.json')
}

$count = 0
foreach ($f in $files) {
  $bytes = [System.IO.File]::ReadAllBytes($f.FullName)
  # skip binary-looking
  if ($bytes.Length -gt 0 -and $bytes[0] -eq 0) { continue }
  $text = [System.Text.Encoding]::UTF8.GetString($bytes)
  # detect BOM
  $utf8 = New-Object System.Text.UTF8Encoding $false
  if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $text = [System.Text.Encoding]::UTF8.GetString($bytes, 3, $bytes.Length - 3)
  }
  $orig = $text

  $text = $text.Replace('application/x-lite-ssh-conn', 'application/x-lite-connect-conn')
  $text = $text.Replace('liteSSH-command-snippets', 'liteConnect-command-snippets')
  $text = $text.Replace('liteSSH-db-connections.json', 'liteConnect-db-connections.json')
  $text = $text.Replace('liteSSH-connections.json', 'liteConnect-connections.json')
  $text = $text.Replace('liteSSH-command-snippets.json', 'liteConnect-command-snippets.json')
  $text = $text.Replace('x-litessh-docker-error', 'x-liteconnect-docker-error')
  $text = $text.Replace('liteSSH-test-userdata', 'liteConnect-test-userdata')
  $text = $text.Replace('window.liteSSH', 'window.liteConnect')
  $text = $text.Replace("exposeInMainWorld('liteSSH'", "exposeInMainWorld('liteConnect'")
  $text = $text.Replace('build/liteSSH.', 'build/liteConnect.')
  $text = $text.Replace('dist/liteSSH.', 'dist/liteConnect.')
  $text = $text.Replace('./liteSSH.', './liteConnect.')
  $text = $text.Replace('../build/liteSSH.', '../build/liteConnect.')
  $text = $text.Replace('../dist/liteSSH.', '../dist/liteConnect.')
  $text = $text.Replace('[liteSSH]', '[liteConnect]')
  $text = $text.Replace('com.litessh.app', 'com.liteconnect.app')
  $text = $text.Replace('"name": "lite-ssh"', '"name": "lite-connect"')
  $text = $text.Replace("'liteSSH.", "'liteConnect.")
  $text = $text.Replace('"liteSSH.', '"liteConnect.')
  $text = $text.Replace('liteSSH', 'liteConnect')
  $text = $text.Replace('LiteSSH', 'liteConnect')

  if ($text -ne $orig) {
    [System.IO.File]::WriteAllText($f.FullName, $text, $utf8)
    $count++
    Write-Host ("updated: " + $f.FullName.Substring($root.Length + 1))
  }
}

Write-Host ("Updated files: $count")

Write-Host '--- remaining old brand ---'
Get-ChildItem -Recurse -File | Where-Object {
  $p = $_.FullName
  if ($p -match '\\node_modules\\|\\release\\|\\dist-electron\\|\\dist\\') { return $false }
  $ext = $_.Extension.ToLowerInvariant()
  return $ext -in @('.ts', '.vue', '.js', '.mjs', '.html', '.yml', '.yaml', '.md', '.json')
} | ForEach-Object {
  $lines = Select-String -LiteralPath $_.FullName -Pattern 'liteSSH|LiteSSH|litessh|lite-ssh|x-litessh' -ErrorAction SilentlyContinue
  foreach ($m in $lines) {
    $rel = $_.FullName.Substring($root.Length + 1)
    Write-Host ("${rel}:$($m.LineNumber):$($m.Line.Trim())")
  }
}
