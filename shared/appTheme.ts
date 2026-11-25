export const APP_THEME_PRESETS = ['dark', 'light', 'eyecare', 'nord', 'catppuccin-mocha', 'solarized-light'] as const
export type PresetAppTheme = (typeof APP_THEME_PRESETS)[number]
export type AppTheme = PresetAppTheme | 'custom'

export function isAppTheme(value: unknown): value is AppTheme {
  return value === 'custom' || APP_THEME_PRESETS.some(theme => theme === value)
}

export function isLightAppTheme(value: unknown): boolean {
  return value === 'light' || value === 'eyecare' || value === 'solarized-light'
}

export const TERMINAL_PALETTES = ['auto', ...APP_THEME_PRESETS, 'dracula', 'solarized-dark', 'monokai'] as const
export type TerminalPaletteId = (typeof TERMINAL_PALETTES)[number]
