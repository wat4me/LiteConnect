import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const { baseCompile } = require('@intlify/message-compiler')

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (['node_modules', 'dist', 'website', '.git', 'scripts'].includes(ent.name)) continue
      walk(p, files)
    } else if (/\.(vue|ts|js)$/.test(ent.name) && !ent.name.endsWith('.d.ts')) {
      files.push(p)
    }
  }
  return files
}

/** Collect all t('a.b.c') style keys from source files */
function collectUsedKeys(roots) {
  const keyRe = /\bt\(\s*['"]([a-zA-Z][a-zA-Z0-9_.]*)['"]/g
  const used = new Map()
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const f of walk(root)) {
      const text = fs.readFileSync(f, 'utf8')
      let m
      while ((m = keyRe.exec(text))) {
        const k = m[1]
        if (!used.has(k)) used.set(k, [])
        used.get(k).push(path.relative('.', f).replace(/\\/g, '/'))
      }
    }
  }
  return used
}

/** Evaluate locale TS module's default export via transpile.
 *  Supports relative imports so zh-CN.ts can aggregate per-domain modules. */
function loadLocaleModule(modulePath, cache) {
  const abs = path.resolve(modulePath)
  if (cache.has(abs)) return cache.get(abs)
  const src = fs.readFileSync(abs, 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  }).outputText
  const module = { exports: {} }
  cache.set(abs, module)
  const localRequire = (spec) => {
    if (!spec.startsWith('.')) throw new Error(`require not supported in locale: ${spec}`)
    let resolved = path.resolve(path.dirname(abs), spec)
    if (!path.extname(resolved)) resolved += '.ts'
    return loadLocaleModule(resolved, cache).exports
  }
  const fn = new Function('exports', 'module', 'require', js)
  fn(module.exports, module, localRequire)
  return module
}

function loadLocaleObject(localePath) {
  const module = loadLocaleModule(localePath, new Map())
  return module.exports.default ?? module.exports
}

function flatten(obj, prefix = '', out = new Set()) {
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) {
    if (prefix) out.add(prefix)
    return out
  }
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.add(p)
    else if (v && typeof v === 'object') flatten(v, p, out)
  }
  return out
}

function report(label, roots, localePath, skipI18nDir = false) {
  const used = new Map()
  const keyRe = /\bt\(\s*['"]([a-zA-Z][a-zA-Z0-9_.]*)['"]/g
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const f of walk(root)) {
      if (skipI18nDir && f.includes(`${path.sep}i18n${path.sep}`)) continue
      const text = fs.readFileSync(f, 'utf8')
      let m
      while ((m = keyRe.exec(text))) {
        const k = m[1]
        if (!used.has(k)) used.set(k, [])
        used.get(k).push(path.relative('.', f).replace(/\\/g, '/'))
      }
    }
  }
  const locale = loadLocaleObject(localePath)
  const defined = flatten(locale)
  const missing = []
  for (const k of [...used.keys()].sort()) {
    if (!defined.has(k)) missing.push({ key: k, files: [...new Set(used.get(k))] })
  }
  console.log(`\n######## ${label} ########`)
  console.log(`Used keys: ${used.size}`)
  console.log(`Defined leaf keys: ${defined.size}`)
  console.log(`Missing: ${missing.length}`)
  for (const m of missing) {
    console.log(m.key)
    console.log(`  @ ${m.files.join(', ')}`)
  }
  return missing.length
}

/** Compile renderer messages with vue-i18n's compiler (prod throws on `@host` etc.). */
function collectStringLeaves(obj, prefix = '', out = []) {
  if (typeof obj === 'string') {
    if (prefix) out.push({ key: prefix, message: obj })
    return out
  }
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return out
  for (const [k, v] of Object.entries(obj)) {
    collectStringLeaves(v, prefix ? `${prefix}.${k}` : k, out)
  }
  return out
}

function reportCompileErrors(localePath) {
  const locale = loadLocaleObject(localePath)
  const leaves = collectStringLeaves(locale)
  const bad = []
  for (const { key, message } of leaves) {
    const errs = []
    baseCompile(message, {
      jit: true,
      onError: (e) => errs.push({ code: e.code, message: e.message }),
    })
    if (errs.length) bad.push({ key, message, errs })
  }
  console.log(`\n######## renderer message compile (vue-i18n) ########`)
  console.log(`Messages: ${leaves.length}`)
  console.log(`Compile errors: ${bad.length}`)
  for (const b of bad) {
    console.log(b.key)
    console.log(`  ${JSON.stringify(b.message)}`)
    for (const e of b.errs) console.log(`  [${e.code}] ${e.message}`)
  }
  return bad.length
}

const r1 = report('renderer (src)', ['src'], 'src/i18n/locales/zh-CN.ts')
const r2 = report('main (electron)', ['electron'], 'electron/i18n/zh-CN.ts', true)
const r3 = reportCompileErrors('src/i18n/locales/zh-CN.ts')
console.log(`\nTotal missing: ${r1 + r2}; compile errors: ${r3}`)
if (r1 + r2 + r3 > 0) process.exit(1)
