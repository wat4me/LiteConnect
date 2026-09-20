import fs from 'node:fs'
import path from 'node:path'

const sourceRoot = path.join(process.cwd(), 'src')
const actionGlyphPattern = /[×✕✖✗✘❌⋯●○↑↓▾▸▹►◀◁◂◄▲△▼▽▿↻↺⟳⟲⌄⌃⚙🔍🔎📋📁📂📄🗑✎✏✓✔☑⚠ℹ◆◇★☆🔑🔒🔓👁📌🔔🐳]/u
const checks = [
  {
    message: '不要使用 input[type="search"] 的浏览器原生清除图标，请改用 text + AppIcon。',
    pattern: /type\s*=\s*["']search["']/u,
  },
  {
    message: '不要在按钮中使用文字 + / −，请使用 AppIcon plus / minus。',
    pattern: />\s*[+−]\s*<\/button>/u,
  },
]

function vueFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name)
    if (entry.isDirectory()) return vueFiles(target)
    return entry.isFile() && entry.name.endsWith('.vue') ? [target] : []
  })
}

function lineOf(source, index) {
  return source.slice(0, index).split(/\r?\n/u).length
}

const failures = []
for (const file of vueFiles(sourceRoot)) {
  const source = fs.readFileSync(file, 'utf8')
  const scanSource = source.replace(/<!--[\s\S]*?-->|\/\*[\s\S]*?\*\//gu, (comment) =>
    comment.replace(/[^\r\n]/gu, ' '),
  )
  for (const check of checks) {
    const match = check.pattern.exec(scanSource)
    if (match) failures.push({ file, line: lineOf(source, match.index), message: check.message })
  }

  const glyph = actionGlyphPattern.exec(scanSource)
  if (glyph) {
    failures.push({
      file,
      line: lineOf(source, glyph.index),
      message: `发现原生字符图标“${glyph[0]}”，请使用 AppIcon。`,
    })
  }
}

if (failures.length) {
  for (const failure of failures) {
    console.error(`${path.relative(process.cwd(), failure.file)}:${failure.line} ${failure.message}`)
  }
  process.exitCode = 1
} else {
  console.log('Unified icon check passed.')
}
