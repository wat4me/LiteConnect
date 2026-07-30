import fs from 'fs'
import path from 'path'
import ts from 'typescript'

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (['node_modules', 'dist', 'website', '.git', 'scripts'].includes(ent.name)) continue
      walk(p, files)
    } else if (/\.(vue|ts)$/.test(ent.name) && !ent.name.endsWith('.d.ts') && !ent.name.endsWith('.test.ts')) {
      files.push(p)
    }
  }
  return files
}

function loadLocale(localePath) {
  const src = fs.readFileSync(localePath, 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const module = { exports: {} }
  new Function('exports', 'module', 'require', js)(module.exports, module, () => {
    throw new Error('no require')
  })
  return module.exports.default ?? module.exports
}

function flatten(obj, prefix = '', out = new Set()) {
  if (typeof obj === 'string') {
    out.add(prefix)
    return out
  }
  if (!obj || typeof obj !== 'object') return out
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') out.add(p)
    else flatten(v, p, out)
  }
  return out
}

const defined = flatten(loadLocale('src/i18n/locales/zh-CN.ts'))

// Collect shellSuggest descKeys
const catalog = fs.readFileSync('src/utils/shellCommandCatalog.ts', 'utf8')
const descKeys = [...catalog.matchAll(/descKey:\s*'([^']+)'/g)].map((m) => m[1])
const missingDesc = descKeys.filter((k) => !defined.has(k))

// docker action dynamic keys
const actions = ['start', 'stop', 'restart']
const dynDocker = []
for (const a of actions) {
  for (const k of [
    `docker.actions.${a}`,
    `docker.actions.${a}Busy`,
    `docker.actions.${a}Aria`,
    `docker.actions.${a}ing`,
  ]) {
    dynDocker.push({ key: k, ok: defined.has(k) })
  }
}

// docker.state.* common
const states = ['running', 'exited', 'created', 'dead', 'paused', 'restarting', 'removing', 'unknown']
const dynState = states.map((s) => ({ key: `docker.state.${s}`, ok: defined.has(`docker.state.${s}`) }))

console.log('=== shellSuggest descKeys missing ===')
console.log(missingDesc.length ? missingDesc.join('\n') : '(none)')

console.log('\n=== docker.actions dynamic candidates ===')
for (const d of dynDocker) console.log(d.ok ? 'OK ' : 'MISS', d.key)

console.log('\n=== docker.state.* ===')
for (const d of dynState) console.log(d.ok ? 'OK ' : 'MISS', d.key)

// Hardcoded Chinese alerts that bypass i18n (informational)
const hard = []
for (const f of walk('src')) {
  const text = fs.readFileSync(f, 'utf8')
  if (/window\.alert\s*\(\s*`/.test(text) || /window\.alert\s*\(\s*'[^']*[\u4e00-\u9fff]/.test(text)) {
    hard.push(path.relative('.', f).replace(/\\/g, '/'))
  }
  // ElMessage with Chinese literal
  if (/ElMessage\.\w+\(\s*['"`][^'"`]*[\u4e00-\u9fff]/.test(text)) {
    hard.push('ElMessage-zh: ' + path.relative('.', f).replace(/\\/g, '/'))
  }
}
console.log('\n=== possible hardcoded UI alerts ===')
console.log([...new Set(hard)].join('\n') || '(none)')

// Verify followPausedContainer exists
console.log('\n=== recent keys ===')
for (const k of [
  'sftp.followPausedContainer',
  'sftp.locateTerminalCwd',
  'app.transferComplete',
  'common.upload',
  'dialog.decryptFailedTitle',
]) {
  console.log(defined.has(k) ? 'OK ' : 'MISS', k)
}
