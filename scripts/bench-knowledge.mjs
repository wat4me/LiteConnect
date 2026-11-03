import { build } from 'esbuild'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { performance } from 'node:perf_hooks'

const fixture = mkdtempSync(join(tmpdir(), 'liteconnect-knowledge-bench-'))
const bundle = join(fixture, 'runtime.mjs')
await build({ stdin: { contents: "export { AppDatabase } from './electron/store/appDatabase'; export { AiKnowledgeService, knowledgeIndex, knowledgeStorageKey } from './electron/ai/knowledge/knowledgeService';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle,
  plugins: [{ name: 'isolated-electron', setup(builder) { builder.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'fixture' })); builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const app={getPath:()=>${JSON.stringify(fixture)},getLocale:()=>"en-US"};` })) } }] })
const { AppDatabase, AiKnowledgeService, knowledgeIndex, knowledgeStorageKey } = await import(pathToFileURL(bundle))
const counts = (process.argv.find(arg => arg.startsWith('--sizes='))?.slice(8) || '100,1000,5000').split(',').map(Number)
if (counts.some(count => !Number.isInteger(count) || count < 1 || count > 10000)) throw new Error('Invalid fixture sizes')
const results = []
let database
try {
  for (const count of counts) {
    database = new AppDatabase(join(fixture, `knowledge-${count}.sqlite`))
    const profiles = Array.from({ length: count }, (_, i) => ({ connectionId: `server-${i}`, name: `Server ${i}`, host: `server-${i}.test`, port: 22, username: 'ops' }))
    const profileMap = new Map(profiles.map(profile => [profile.connectionId, profile]))
    let profileReads = 0, collecting = false, decodedBytes = 0, selected = [profiles[0]]
    for (const method of ['getSingleton', 'getDocument']) if (typeof database[method] === 'function') {
      const original = database[method].bind(database)
      database[method] = (...args) => { const value = original(...args); if (collecting && value !== undefined) decodedBytes += Buffer.byteLength(JSON.stringify(value)); return value }
    }
    const state = (number, heavy = false) => ({ enabled: true, mode: 'readwrite', documents: Array.from({ length: heavy ? 20 : 4 }, (_, i) => {
      const content = `Service ${number}/${i}: ` + 'x'.repeat((heavy ? 32700 : 1900))
      return { id: `doc-${i}`, title: `Service ${i}`, content, revision: 6, author: 'user', updatedAt: 6, alwaysInclude: i === 0,
        history: Array.from({ length: 5 }, (_, revision) => ({ title: `Service ${i}`, content, revision: revision + 1, author: 'user', updatedAt: revision + 1, alwaysInclude: i === 0 })) }
    }) })
    const seededAt = performance.now()
    database.transaction(() => { for (let i = 0; i < count; i++) { const saved = state(i), key = knowledgeStorageKey(profiles[i]); database.setSingleton(key, saved); database.setSingleton(`index:${key}`, knowledgeIndex(saved)) } })
    const service = new AiKnowledgeService(() => selected, () => database, join(fixture, `knowledge-${count}.sqlite`), () => { profileReads++; return profiles }, { revision: () => 1, get: id => profileMap.get(id) })
    for (let i = 0; i < Math.min(100, Math.ceil(count / 100)); i++) service.groups.manage({ action: 'create', name: `Group ${i}`, connectionIds: profiles.slice(i * 100, (i + 1) * 100).map(profile => profile.connectionId), initialContent: 'Common deployment: /opt/service' })
    const seedMs = performance.now() - seededAt
    let access = service.access('fixture', 1)
    const overview = await access.manage({ action: 'overview' })
    const binding = overview.targets[0].binding
    const firstAt = performance.now(); await access.manage({ action: 'read', connectionId: profiles[0].connectionId, documentId: 'doc-0' }); const firstReadMs = performance.now() - firstAt
    async function measure(name, operation, iterations = 12) {
      for (let i = 0; i < 2; i++) await operation(i)
      const times = []
      for (let i = 0; i < iterations; i++) { const start = performance.now(); await operation(i); times.push(performance.now() - start) }
      decodedBytes = 0; profileReads = 0; collecting = true; await operation(0); collecting = false
      times.sort((a, b) => a - b)
      return { name, medianMs: +times[Math.floor(times.length / 2)].toFixed(3), p95Ms: +times[Math.min(times.length - 1, Math.ceil(times.length * .95) - 1)].toFixed(3), decodedBytes, fullProfileReads: profileReads }
    }
    const operations = []
    operations.push(await measure('overview', () => access.manage({ action: 'overview' })))
    operations.push(await measure('read-document-with-history', () => access.manage({ action: 'read', connectionId: profiles[0].connectionId, documentId: 'doc-0' })))
    operations.push(await measure('ai-read-current', () => access.call('knowledge_read', { connectionId: profiles[0].connectionId, documentId: 'doc-0' }, new AbortController().signal)))
    operations.push(await measure('search-current', () => access.call('knowledge_search', { connectionId: profiles[0].connectionId, query: 'Service' }, new AbortController().signal)))
    let revision = (await access.manage({ action: 'read', connectionId: profiles[0].connectionId, documentId: 'doc-0' })).document.revision
    operations.push(await measure('save-one-document', async i => { const response = await access.manage({ action: 'save', connectionId: profiles[0].connectionId, binding, documentId: 'doc-0', title: 'Service 0', content: `Confirmed deployment ${i}: /opt/service`, expectedRevision: revision }); revision = response.document.revision }))
    selected = profiles.slice(0, 20); access = service.access('fixture', 1)
    operations.push(await measure('prompt-selected-20', () => access.prompt()))
    selected = [profiles[0]]
    const heavy = state(0, true), key = knowledgeStorageKey(profiles[0])
    database.transaction(() => { database.setSingleton(key, heavy); database.setSingleton(`index:${key}`, knowledgeIndex(heavy)) })
    access = service.access('heavy-fixture', 1)
    const heavyStart = performance.now(); await access.manage({ action: 'read', connectionId: profiles[0].connectionId, documentId: 'doc-0' }); const heavyFirstReadMs = performance.now() - heavyStart
    operations.push(await measure('heavy-ai-read-current', () => access.call('knowledge_read', { connectionId: profiles[0].connectionId, documentId: 'doc-0' }, new AbortController().signal)))
    results.push({ servers: count, documentsPerServer: 4, historyPerDocument: 5, seedMs: +seedMs.toFixed(1), firstReadMs: +firstReadMs.toFixed(3), heavyFirstReadMs: +heavyFirstReadMs.toFixed(3), operations })
    database.close(); database = undefined
  }
  const report = { generatedAt: new Date().toISOString(), node: process.version, platform: process.platform, fixture: 'real SQLite; 4 documents × ~2 KB × 6 versions/server; heavy case 20 documents × ~32 KB × 6 versions; synthetic local data, no SSH or AI network', results }
  const output = process.argv.find(arg => arg.startsWith('--output='))?.slice(9)
  if (output) { mkdirSync(resolve(output, '..'), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2)) }
  console.log(JSON.stringify(report))
} finally {
  database?.close()
  const root = realpathSync(tmpdir()) + sep, target = realpathSync(fixture)
  if (!target.startsWith(root) || !target.split(sep).at(-1).startsWith('liteconnect-knowledge-bench-')) throw new Error('Invalid fixture cleanup path')
  rmSync(target, { recursive: true, force: true })
}
