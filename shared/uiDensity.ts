export const UI_DENSITIES = ['compact', 'standard', 'comfortable'] as const
export type UiDensity = (typeof UI_DENSITIES)[number]
export const DEFAULT_UI_DENSITY: UiDensity = 'standard'

/** Unknown or missing values fall back to the default. */
export function normalizeUiDensity(value: unknown): UiDensity {
  return (UI_DENSITIES as readonly unknown[]).includes(value) ? value as UiDensity : DEFAULT_UI_DENSITY
}
