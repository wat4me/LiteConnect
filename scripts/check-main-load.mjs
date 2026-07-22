import { createRequire } from 'module'
import fs from 'fs'

const require = createRequire(import.meta.url)

try {
  require('../dist-electron/main.js')
  console.log('main loaded ok')
} catch (e) {
  console.log('ERR:', e.message)
  if (String(e.message).includes('Bt') || String(e.message).includes('before initialization')) {
    console.error('STILL TDZ BUG')
    process.exit(1)
  }
  console.log('Not TDZ (electron-only runtime expected):', String(e.message).slice(0, 160))
}

require('mysql2/promise')
require('pg')
console.log('mysql2+pg require ok')

const s = fs.readFileSync(new URL('../dist-electron/main.js', import.meta.url), 'utf8')
console.log('main.js size', s.length)
console.log('external mysql2', /require\(["']mysql2/.test(s))
console.log('external pg', /require\(["']pg["']\)/.test(s))
