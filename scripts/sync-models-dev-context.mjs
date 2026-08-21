/**
 * Refresh shared/modelsDevContext.json from https://models.dev/models.json
 * (provider-agnostic model metadata; we only keep limit.context).
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

function compact(src) {
  const full = new Map()
  const shortHits = new Map()

  for (const [rawId, rec] of Object.entries(src || {})) {
    const id = normalizeId(rec && rec.id ? rec.id : rawId)
    const ctx = rec && rec.limit ? rec.limit.context : undefined
    if (!id || typeof ctx !== 'number' || !Number.isFinite(ctx) || ctx <= 0) continue
    const n = Math.round(ctx)
    full.set(id, n)
    const slash = id.lastIndexOf('/')
    const short = slash >= 0 ? id.slice(slash + 1) : id
    if (!short) continue
    if (!shortHits.has(short)) shortHits.set(short, new Set())
    shortHits.get(short).add(n)
  }

  const context = {}
  for (const [id, n] of [...full.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    context[id] = n
  }
  for (const [short, set] of [...shortHits.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (set.size !== 1) continue
    if (context[short] == null) context[short] = [...set][0]
  }
  return context
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
const context = compact(src)
const payload = {
  source: SOURCE,
  fetchedAt: new Date().toISOString().slice(0, 10),
  context,
}
fs.writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`)
console.log(`wrote ${OUT} (${Object.keys(context).length} ids)`)
