import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import ts from 'typescript'
import { reportHardcodedChinese } from './check-i18n-hardcoded.mjs'

const require = createRequire(import.meta.url)
const { baseCompile } = require('@intlify/message-compiler')

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (['node_modules', 'dist', '.git', 'scripts'].includes(ent.name)) continue
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
    const candidates = [resolved, `${resolved}.ts`, path.join(resolved, 'index.ts')]
    resolved = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile())
    if (!resolved) throw new Error(`Cannot resolve locale import ${spec} from ${abs}`)
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

function leafMap(obj, prefix = '', out = new Map()) {
  if (typeof obj === 'string') {
    if (prefix) out.set(prefix, obj)
    return out
  }
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return out
  for (const [k, v] of Object.entries(obj)) leafMap(v, prefix ? `${prefix}.${k}` : k, out)
  return out
}

function namedCountsFromMessage(message) {
  const counts = new Map()
  const errors = []
  const compiled = baseCompile(message, {
    jit: true,
    onError: (e) => errors.push(e.message || String(e.code || 'compile error')),
  })
  const walk = (node) => {
    if (!node || typeof node !== 'object') return
    if (node.type === 4) {
      const name = typeof node.key === 'string' ? node.key : node.key?.name
      if (name) counts.set(name, (counts.get(name) || 0) + 1)
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') walk(value)
    }
  }
  walk(compiled.ast)
  return { counts, errors }
}

function simpleNamedCounts(message) {
  const counts = new Map()
  for (const match of message.matchAll(/\{(\w+)\}/g)) {
    counts.set(match[1], (counts.get(match[1]) || 0) + 1)
  }
  return counts
}

function countsEqual(a, b) {
  if (a.size !== b.size) return false
  for (const [key, count] of a) if (b.get(key) !== count) return false
  return true
}

function formatCounts(counts) {
  return [...counts.entries()].map(([k, n]) => `${k}×${n}`).join(', ') || '(none)'
}

/**
 * English strings may keep a native proper name. Each key needs its own reason.
 * Do not exclude a whole module.
 */
const EN_HAN_ALLOW = new Map([
  ['settingsApp.languageZh', 'Native name of Simplified Chinese in the language menu'],
])

/** CJK Unified Ideographs, extension A, and compatibility ideographs. */
const HAN_CHAR = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/

function compareCatalogs(label, zhPath, enPath, { vueI18n }) {
  const zh = leafMap(loadLocaleObject(zhPath))
  const en = leafMap(loadLocaleObject(enPath))
  const missing = [...zh.keys()].filter((key) => !en.has(key)).sort()
  const extra = [...en.keys()].filter((key) => !zh.has(key)).sort()
  const placeholder = []
  const compile = []
  const han = []
  for (const key of [...zh.keys()].filter((item) => en.has(item)).sort()) {
    const zhMessage = zh.get(key)
    const enMessage = en.get(key)
    if (vueI18n) {
      const left = namedCountsFromMessage(zhMessage)
      const right = namedCountsFromMessage(enMessage)
      if (left.errors.length) compile.push({ key, side: 'zh-CN', errors: left.errors, message: zhMessage })
      if (right.errors.length) compile.push({ key, side: 'en-US', errors: right.errors, message: enMessage })
      if (!countsEqual(left.counts, right.counts)) {
        placeholder.push({ key, zh: formatCounts(left.counts), en: formatCounts(right.counts) })
      }
    } else if (!countsEqual(simpleNamedCounts(zhMessage), simpleNamedCounts(enMessage))) {
      placeholder.push({
        key,
        zh: formatCounts(simpleNamedCounts(zhMessage)),
        en: formatCounts(simpleNamedCounts(enMessage)),
      })
    }
    if (HAN_CHAR.test(enMessage) && !EN_HAN_ALLOW.has(key)) {
      han.push({ key, message: enMessage })
    }
  }
  console.log(`\n######## ${label} key parity ########`)
  console.log(`zh-CN: ${zh.size}; en-US: ${en.size}; missing: ${missing.length}; extra: ${extra.length}`)
  for (const key of missing) console.log(`missing ${key}`)
  for (const key of extra) console.log(`extra ${key}`)
  console.log(`Placeholder mismatches: ${placeholder.length}`)
  for (const item of placeholder) console.log(`${item.key}\n  zh ${item.zh}\n  en ${item.en}`)
  console.log(`Compile errors: ${compile.length}`)
  for (const item of compile) {
    console.log(`${item.side} ${item.key}`)
    console.log(`  ${JSON.stringify(item.message)}`)
    for (const error of item.errors) console.log(`  ${error}`)
  }
  console.log(`Unlisted Chinese in English: ${han.length}`)
  for (const item of han) console.log(`${item.key}\n  ${JSON.stringify(item.message)}`)
  return missing.length + extra.length + placeholder.length + compile.length + han.length
}

function assertSelfTest() {
  const badPlaceholder = namedCountsFromMessage('Selected {count}')
  const goodPlaceholder = namedCountsFromMessage('已选 {count} 项')
  const broken = namedCountsFromMessage('mail me at user@host')
  const literalAt = namedCountsFromMessage("mysql://user{'@'}host")
  const failures = []
  if (badPlaceholder.counts.get('count') !== 1) failures.push('named {count} was not counted')
  if (!countsEqual(badPlaceholder.counts, goodPlaceholder.counts)) failures.push('matching placeholders were treated as different')
  if (!broken.errors.length) failures.push('bare @ was accepted')
  if (literalAt.errors.length) failures.push("{'@'} literal failed to compile")
  if (literalAt.counts.size !== 0) failures.push("{'@'} was treated as a named placeholder")
  const zh = new Map([['a', '你好 {name}'], ['b', '仅中文']])
  const en = new Map([['a', 'Hello'], ['c', 'Extra']])
  if (en.has('b') || zh.has('c') || countsEqual(simpleNamedCounts(zh.get('a')), simpleNamedCounts(en.get('a')))) {
    failures.push('fixture key or placeholder mismatch was not detectable')
  }
  if (!HAN_CHAR.test('简体中文')) failures.push('Han detection failed')
  console.log(`\n######## i18n detector self-test ########`)
  if (failures.length) {
    for (const failure of failures) console.log(failure)
    return failures.length
  }
  console.log('Detectors caught a missing key, a bad placeholder, a bare @, and a literal @')
  return 0
}

const r1 = report('renderer (src)', ['src'], 'src/i18n/locales/zh-CN.ts')
const r2 = report('main (electron)', ['electron'], 'electron/i18n/zh-CN.ts', true)
const r3 = compareCatalogs('renderer', 'src/i18n/locales/zh-CN.ts', 'src/i18n/locales/en-US.ts', { vueI18n: true })
const r4 = compareCatalogs('main', 'electron/i18n/zh-CN.ts', 'electron/i18n/en-US.ts', { vueI18n: false })
const r5 = assertSelfTest()
const r6 = reportHardcodedChinese()
console.log(`\nTotal missing refs: ${r1 + r2}; catalog errors: ${r3 + r4}; self-test: ${r5}; hardcoded Chinese: ${r6}`)
if (r1 + r2 + r3 + r4 + r5 + r6 > 0) process.exit(1)
