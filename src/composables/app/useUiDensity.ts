import { normalizeUiDensity } from '@shared/uiDensity'

const DENSITY_KEY = 'liteconnect-ui-density'
const FONT_SIZE_KEY = 'liteconnect-ui-font-size'

/** Apply committed sizes independently and cache them for the next window's first paint. */
export function applyUiSizes(settings: { uiDensity?: unknown; uiFontSize?: unknown }) {
  if (typeof document === 'undefined') return
  const density = normalizeUiDensity(settings.uiDensity)
  const fontSize = normalizeUiDensity(settings.uiFontSize)
  const { dataset } = document.documentElement
  dataset.uiDensity = density
  dataset.uiFontSize = fontSize
  try {
    localStorage.setItem(DENSITY_KEY, density)
    localStorage.setItem(FONT_SIZE_KEY, fontSize)
  } catch { /* The cache is only a convenience. */ }
}

try {
  applyUiSizes({ uiDensity: localStorage.getItem(DENSITY_KEY), uiFontSize: localStorage.getItem(FONT_SIZE_KEY) })
} catch {
  // The app bootstrap will apply the stored settings even when the cache is unavailable.
}
