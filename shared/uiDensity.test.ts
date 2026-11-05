import { describe, expect, it } from 'vitest'
import { DEFAULT_UI_DENSITY, UI_DENSITIES, normalizeUiDensity } from './uiDensity'

describe('ui density', () => {
  it('keeps the known densities and falls back to the default', () => {
    expect(UI_DENSITIES).toEqual(['compact', 'standard', 'comfortable'])
    for (const density of UI_DENSITIES) expect(normalizeUiDensity(density)).toBe(density)
    for (const value of [undefined, null, '', 'tight', 3, {}]) expect(normalizeUiDensity(value)).toBe(DEFAULT_UI_DENSITY)
  })
})
