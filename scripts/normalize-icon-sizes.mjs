import fs from 'fs'
import path from 'path'

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'dist' || ent.name === 'dist-electron') continue
      walk(p, out)
    } else if (ent.name.endsWith('.vue')) {
      out.push(p)
    }
  }
  return out
}

const map = {
  10: 'xs',
  11: 'xs',
  12: 'xs',
  13: 'sm',
  14: 'sm',
  15: 'md',
  16: 'md',
  17: 'lg',
  18: 'lg',
  19: 'xl',
  20: 'xl',
  21: 'xl',
  22: 'xl',
  24: '2xl',
  26: '2xl',
  28: '2xl',
  32: '2xl',
  40: 'hero',
  48: 'hero',
}

const files = walk('src')
let changedFiles = 0
let replacements = 0

for (const file of files) {
  const text = fs.readFileSync(file, 'utf8')
  if (!text.includes('AppIcon')) continue
  const next = text.replace(/:size="(\d+)"/g, (m, n) => {
    const tok = map[Number(n)]
    if (!tok) return m
    replacements++
    return `size="${tok}"`
  })
  if (next !== text) {
    fs.writeFileSync(file, next)
    changedFiles++
  }
}

console.log(`Normalized AppIcon sizes in ${changedFiles} files (${replacements} replacements)`)
