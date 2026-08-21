import catalog from './modelsDevContext.json'

export const MODELS_DEV_SOURCE = catalog.source
export const MODELS_DEV_FETCHED_AT = catalog.fetchedAt

const contextById = catalog.context as Record<string, number>

export function normalizeModelId(id: string): string {
  return id.trim().toLowerCase().replace(/_/g, '-')
}

/** Advertised context window from the shipped models.dev snapshot. */
export function lookupModelsDevContext(model?: string): number | undefined {
  const raw = normalizeModelId(model || '')
  if (!raw) return undefined
  const direct = contextById[raw]
  if (isPositiveInt(direct)) return direct
  const slash = raw.lastIndexOf('/')
  if (slash >= 0) {
    const viaShort = contextById[raw.slice(slash + 1)]
    if (isPositiveInt(viaShort)) return viaShort
  }
  return undefined
}

function isPositiveInt(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}
