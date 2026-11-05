/**
 * Refresh shared/modelsDevContext.json from https://models.dev/models.json
 * (provider-agnostic model metadata; we keep limit.context and limit.output).
 *
 * Usage: node scripts/sync-models-dev-context.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = 'https://models.dev/models.json'
const UA = 'LiteConnect/models-dev-sync (https://github.com/)'
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'shared', 'modelsDevContext.json')

function normalizeId(id) {
  return String(id).trim().toLowerCase().replace(/_/g, '-')
}

function collect(src, pick) {
  const full = new Map()
  const shortHits = new Map()

  for (const [rawId, rec] of Object.entries(src || {})) {
    const id = normalizeId(rec && rec.id ? rec.id : rawId)
    const value = pick(rec)
    if (!id || typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    const n = Math.round(value)
    full.set(id, n)
    const slash = id.lastIndexOf('/')
    const short = slash >= 0 ? id.slice(slash + 1) : id
    if (!short) continue
    if (!shortHits.has(short)) shortHits.set(short, new Set())
    shortHits.get(short).add(n)
  }

  const map = {}
  for (const [id, n] of [...full.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    map[id] = n
  }
  // A short id is added only when every provider advertises the same value for it.
  for (const [short, set] of [...shortHits.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (set.size !== 1) continue
    if (map[short] == null) map[short] = [...set][0]
  }
  return map
}

async function fetchCatalog() {
  const res = await fetch(SOURCE, {
    headers: {
      Accept: 'application/json',
      'User-Agent': UA,
    },
  })
  if (!res.ok) {
    throw new Error(`GET ${SOURCE} failed: HTTP ${res.status}`)
  }
  return res.json()
}

const src = await fetchCatalog()
const context = collect(src, rec => (rec && rec.limit ? rec.limit.context : undefined))
// Entries that advertise no output limit stay out of the map.
const output = collect(src, rec => (rec && rec.limit ? rec.limit.output : undefined))
const payload = {
  source: SOURCE,
  fetchedAt: new Date().toISOString().slice(0, 10),
  context,
  output,
}
fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`)
console.log(`wrote ${OUT} (${Object.keys(context).length} context ids, ${Object.keys(output).length} output ids)`)
