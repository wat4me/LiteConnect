import { DEFAULT_UI_DENSITY, normalizeUiDensity, type UiDensity } from '@shared/uiDensity'

const DENSITY_KEY = 'liteconnect-ui-density'

/** html[data-ui-density] drives the CSS density hook used by every window. */
export function applyUiDensity(value: unknown): UiDensity {
  const density = normalizeUiDensity(value)
  const root = document.documentElement
  if (density === DEFAULT_UI_DENSITY) delete root.dataset.uiDensity
  else root.dataset.uiDensity = density
  try { localStorage.setItem(DENSITY_KEY, density) } catch { /* The cache is only a convenience. */ }
  return density
}

/** Mirrors the theme cache so a fresh window keeps its density before settings arrive. */
function bootstrapUiDensity() {
  let cached: unknown
  try { cached = localStorage.getItem(DENSITY_KEY) } catch { return }
  applyUiDensity(cached)
}

bootstrapUiDensity()
