import { computed, ref } from 'vue'
import { t } from '@/i18n'
import { APP_THEME_PRESETS, TERMINAL_PALETTES, isAppTheme, type AppTheme, type PresetAppTheme, type TerminalPaletteId } from '@shared/appTheme'

export type Theme = AppTheme
export type { TerminalPaletteId }

export interface CustomColors {
  fontColor: string
  bgColor: string
}

const THEME_KEY = 'liteconnect-theme'
const CUSTOM_COLORS_KEY = 'liteconnect-custom-colors'

const themeOrder = [...APP_THEME_PRESETS, 'custom'] as const

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.substring(0, 2), 16),
    parseInt(h.substring(2, 4), 16),
    parseInt(h.substring(4, 6), 16),
  ]
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    '#' +
    [r, g, b]
      .map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0'))
      .join('')
  )
}

function getLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255
}



function mixColors(hex1: string, hex2: string, ratio: number): string {
  const [r1, g1, b1] = hexToRgb(hex1)
  const [r2, g2, b2] = hexToRgb(hex2)
  return rgbToHex(
    r1 + (r2 - r1) * ratio,
    g1 + (g2 - g1) * ratio,
    b1 + (b2 - b1) * ratio,
  )
}

function loadCustomColors(): CustomColors {
  try {
    const saved = localStorage.getItem(CUSTOM_COLORS_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return { fontColor: '#ece9e1', bgColor: '#262624' }
}

const CUSTOM_CSS_VARS = [
  '--bg-primary', '--bg-secondary', '--bg-tertiary', '--border-color',
  '--text-primary', '--text-secondary', '--accent', '--accent-hover',
  '--accent-bg', '--danger', '--success', '--warning',
  '--scrollbar-thumb', '--scrollbar-thumb-hover', '--overlay-bg',
  '--hover-bg', '--selection-bg', '--titlebar-bg', '--titlebar-symbol',
  '--small-text-adjustment',
]

function clearCustomVars() {
  const root = document.documentElement
  for (const v of CUSTOM_CSS_VARS) {
    root.style.removeProperty(v)
  }
}

/** CSS variables for a custom theme. Shared by the app root and the settings preview. */
export function customThemeVariables(colors: CustomColors): Record<string, string> {
  const { fontColor, bgColor } = colors
  const isDark = getLuminance(bgColor) < 0.5
  const chrome = mixColors(bgColor, fontColor, isDark ? 0.08 : 0.04)
  return {
    '--bg-primary': bgColor,
    '--bg-secondary': chrome,
    '--bg-tertiary': mixColors(bgColor, fontColor, isDark ? 0.15 : 0.08),
    '--border-color': mixColors(bgColor, fontColor, isDark ? 0.2 : 0.15),
    '--text-primary': fontColor,
    '--text-secondary': mixColors(fontColor, bgColor, isDark ? 0.4 : 0.45),
    '--accent': isDark ? '#d97757' : '#c4623f',
    '--accent-hover': isDark ? '#e48c6e' : '#a9522f',
    // Keep derived highlights linked to the active token, including CSS overrides.
    '--accent-bg': `color-mix(in srgb, var(--accent) ${isDark ? 10 : 8}%, transparent)`,
    '--danger': isDark ? '#ef6a6a' : '#c2364a',
    '--success': isDark ? '#8cbf73' : '#4c8738',
    '--warning': isDark ? '#e3ac5b' : '#a46c18',
    '--scrollbar-thumb': mixColors(bgColor, fontColor, isDark ? 0.2 : 0.15),
    '--scrollbar-thumb-hover': mixColors(bgColor, fontColor, isDark ? 0.3 : 0.22),
    '--overlay-bg': isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)',
    '--hover-bg': isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)',
    '--selection-bg': `color-mix(in srgb, var(--accent) ${isDark ? 30 : 20}%, transparent)`,
    '--titlebar-bg': chrome,
    '--titlebar-symbol': mixColors(fontColor, bgColor, 0.5),
    '--small-text-adjustment': isDark ? '1px' : '0px',
  }
}

function applyCustomColors(colors: CustomColors) {
  const root = document.documentElement
  root.setAttribute('data-theme', 'custom')
  const variables = customThemeVariables(colors)
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value)
  const chrome = variables['--titlebar-bg']
  try {
    const titleBarColors = { color: chrome, symbolColor: variables['--titlebar-symbol'] }
    window.LiteConnect?.updateTitleBar('custom', titleBarColors)
  } catch {}
}

function applyPresetTheme(t: PresetAppTheme) {
  clearCustomVars()
  document.documentElement.setAttribute('data-theme', t)
  try {
    window.LiteConnect?.updateTitleBar(t)
  } catch {}
}

const storedTheme = localStorage.getItem(THEME_KEY)
const currentTheme = ref<Theme>(isAppTheme(storedTheme) ? storedTheme : 'dark')
const customColors = ref<CustomColors>(loadCustomColors())

function applyTheme(t: Theme) {
  currentTheme.value = t
  localStorage.setItem(THEME_KEY, t)
  if (t === 'custom') {
    localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(customColors.value))
    applyCustomColors(customColors.value)
  } else {
    applyPresetTheme(t)
  }
}

function setCustomColors(colors: CustomColors) {
  customColors.value = colors
  localStorage.setItem(CUSTOM_COLORS_KEY, JSON.stringify(colors))
  if (currentTheme.value === 'custom') {
    applyCustomColors(colors)
  }
}

applyTheme(currentTheme.value)

export function useTheme() {
  function setTheme(next: Theme) {
    applyTheme(next)
  }

  const themeLabels = computed(() => Object.fromEntries(themeOrder.map(id => [id, t(`theme.${id}`)])) as Record<Theme, string>)

  return {
    theme: currentTheme,
    customColors,
    setTheme,
    setCustomColors,
    themeOrder,
    themeLabels,
  }
}

export const terminalPaletteOrder = TERMINAL_PALETTES

export const terminalPaletteLabels: Record<TerminalPaletteId, string> = new Proxy(
  {
    auto: '',
    dark: 'Clay Dark',
    light: 'Clay Light',
    eyecare: '',
    nord: 'Nord',
    'catppuccin-mocha': 'Catppuccin Mocha',
    dracula: 'Dracula',
    'solarized-dark': 'Solarized Dark',
    'solarized-light': 'Solarized Light',
    monokai: 'Monokai',
  } as Record<TerminalPaletteId, string>,
  {
    get(target, prop: string) {
      if (prop === 'auto') return t('theme.paletteAuto')
      if (prop === 'eyecare') return t('theme.eyecare')
      return target[prop as TerminalPaletteId]
    },
  },
)

/**
 * Font stacks must NOT chain other specialty mono fonts as fallbacks.
 * Otherwise selecting "Fira Code" still paints Cascadia when Cascadia is installed
 * first in an old long stack — preview looks unchanged.
 * Prefer: quoted primary + generic monospace only.
 */
export const terminalFontFamilyPresets: Array<{ id: string; label: string; value: string }> = [
  { id: 'cascadia', label: 'Cascadia Code', value: '"Cascadia Code", monospace' },
  { id: 'fira', label: 'Fira Code', value: '"Fira Code", monospace' },
  { id: 'jetbrains', label: 'JetBrains Mono', value: '"JetBrains Mono", monospace' },
  { id: 'consolas', label: 'Consolas', value: 'Consolas, monospace' },
  { id: 'source', label: 'Source Code Pro', value: '"Source Code Pro", monospace' },
  { id: 'system', label: '', value: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
]

// Resolve system font label at access time via getter on the array item
Object.defineProperty(terminalFontFamilyPresets[terminalFontFamilyPresets.length - 1], 'label', {
  get: () => t('theme.fontSystem'),
  enumerable: true,
})

/** Primary family name from a CSS font-family stack (unquoted). */
export function primaryFontName(fontFamily: string): string {
  const first = (fontFamily || '').split(',')[0]?.trim() || ''
  return first.replace(/^["']|["']$/g, '')
}

/**
 * Map legacy long stacks / free text to a preset value so the select stays in sync.
 */
export function normalizeFontFamilyPreset(value: string | null | undefined): string {
  const raw = (value || '').trim()
  if (!raw) return terminalFontFamilyPresets[0].value
  for (const p of terminalFontFamilyPresets) {
    if (p.value === raw) return p.value
  }
  const primary = primaryFontName(raw).toLowerCase()
  for (const p of terminalFontFamilyPresets) {
    if (primaryFontName(p.value).toLowerCase() === primary) return p.value
  }
  // Keep custom stack as-is (will still apply, may not match a <option>)
  return raw
}

/**
 * Detect whether a named font face is actually installed.
 *
 * Do NOT trust `document.fonts.check` alone — Chromium often returns true for
 * fonts that are not installed (so Fira Code / JetBrains Mono always appeared).
 *
 * Classic canvas probe: compare text metrics against several generic baselines.
 * If the named font is missing, the stack falls through to the baseline and
 * widths match for every baseline → not installed.
 */
export function isFontFamilyInstalled(fontFamily: string): boolean {
  if (typeof document === 'undefined') return true
  const name = primaryFontName(fontFamily)
  if (!name) return true
  const lower = name.toLowerCase()
  // Generic CSS families — always treat as available for the "system" option.
  if (lower === 'monospace' || lower === 'ui-monospace' || lower === 'sfmono-regular') {
    return true
  }

  try {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (!ctx) return false

    // Mix of wide / narrow glyphs so metric differences show up.
    const sample = 'mmmmmmmmmmlli@0O1Il|'
    const size = '72px'
    // Multiple baselines: a real face usually differs from at least one generic.
    const baselines = ['monospace', 'sans-serif', 'serif', 'cursive'] as const

    for (const base of baselines) {
      ctx.font = `${size} ${base}`
      const baseWidth = ctx.measureText(sample).width
      ctx.font = `${size} "${name}", ${base}`
      const testWidth = ctx.measureText(sample).width
      if (baseWidth !== testWidth) {
        return true
      }
    }
    return false
  } catch {
    // Fail closed: hide unknown faces rather than listing ghosts.
    return false
  }
}

/** Presets present on this machine (always includes the system mono entry). */
export function listInstalledFontFamilyPresets(): Array<{ id: string; label: string; value: string }> {
  return terminalFontFamilyPresets.filter((p) => {
    if (p.id === 'system') return true
    return isFontFamilyInstalled(p.value)
  })
}

/** Prefer an installed preset; fall back to system mono, then first installed. */
export function pickInstalledFontFamily(preferred?: string | null): string {
  const installed = listInstalledFontFamilyPresets()
  if (installed.length === 0) return terminalFontFamilyPresets[terminalFontFamilyPresets.length - 1].value
  const norm = normalizeFontFamilyPreset(preferred)
  if (installed.some((p) => p.value === norm)) return norm
  const system = installed.find((p) => p.id === 'system')
  return system?.value || installed[0].value
}

const presetPalettes: Record<Exclude<TerminalPaletteId, 'auto'>, Record<string, string>> = {
  dark: {
    background: '#262624',
    foreground: '#e8e5dc',
    cursor: '#d97757',
    selectionBackground: 'rgba(217,119,87,0.30)',
    black: '#1f1e1d',
    red: '#ef7a6f',
    green: '#a5c67c',
    yellow: '#e6b562',
    blue: '#82a9e0',
    magenta: '#c59de0',
    cyan: '#76c3b9',
    white: '#d6d3ca',
    brightBlack: '#8d8a82',
    brightRed: '#f59b91',
    brightGreen: '#bdd99b',
    brightYellow: '#f0cb86',
    brightBlue: '#a4c2ea',
    brightMagenta: '#d8b9ee',
    brightCyan: '#9ad6cd',
    brightWhite: '#faf9f5',
  },
  light: {
    background: '#ffffff',
    foreground: '#21201c',
    cursor: '#c4623f',
    selectionBackground: 'rgba(196,98,63,0.18)',
    black: '#2b2a27',
    red: '#b8432f',
    green: '#3f7d2c',
    yellow: '#8f6510',
    blue: '#2f62b0',
    magenta: '#8a46b0',
    cyan: '#1f7a72',
    white: '#6d6a61',
    brightBlack: '#8a877e',
    brightRed: '#9e3322',
    brightGreen: '#2f6a1f',
    brightYellow: '#7a5508',
    brightBlue: '#234f94',
    brightMagenta: '#723a94',
    brightCyan: '#16645d',
    brightWhite: '#1f1e1d',
  },
  eyecare: {
    background: '#f5f0e8',
    foreground: '#5c5346',
    cursor: '#5b8c5a',
    selectionBackground: 'rgba(91,140,90,0.2)',
    black: '#5c5346',
    red: '#b54a4a',
    green: '#5b8c5a',
    yellow: '#b58c5a',
    blue: '#5a7cb5',
    magenta: '#8c5a8c',
    cyan: '#5a9e9e',
    white: '#8a7f70',
    brightBlack: '#7a7060',
    brightRed: '#c06060',
    brightGreen: '#6a9c6a',
    brightYellow: '#c09c60',
    brightBlue: '#6a8cc0',
    brightMagenta: '#9c6a9c',
    brightCyan: '#6aaeae',
    brightWhite: '#3d3630',
  },
  nord: {
    background: '#2e3440', foreground: '#eceff4', cursor: '#88c0d0',
    selectionBackground: 'rgba(129,161,193,0.35)',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
    blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#76839b', brightRed: '#e08791', brightGreen: '#b7d2a1', brightYellow: '#f3daaa',
    brightBlue: '#9db9d9', brightMagenta: '#cea9c7', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  },
  'catppuccin-mocha': {
    background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc',
    selectionBackground: 'rgba(166,173,200,0.35)',
    black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
    blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
    brightBlack: '#7f849c', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af',
    brightBlue: '#89b4fa', brightMagenta: '#cba6f7', brightCyan: '#89dceb', brightWhite: '#cdd6f4',
  },
  dracula: {
    background: '#282a36',
    foreground: '#f8f8f2',
    cursor: '#f8f8f2',
    selectionBackground: 'rgba(68,71,90,0.8)',
    black: '#21222c',
    red: '#ff5555',
    green: '#50fa7b',
    yellow: '#f1fa8c',
    blue: '#bd93f9',
    magenta: '#ff79c6',
    cyan: '#8be9fd',
    white: '#f8f8f2',
    brightBlack: '#6272a4',
    brightRed: '#ff6e6e',
    brightGreen: '#69ff94',
    brightYellow: '#ffffa5',
    brightBlue: '#d6acff',
    brightMagenta: '#ff92df',
    brightCyan: '#a4ffff',
    brightWhite: '#ffffff',
  },
  'solarized-dark': {
    background: '#002b36',
    foreground: '#839496',
    cursor: '#839496',
    selectionBackground: 'rgba(7,54,66,0.8)',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  'solarized-light': {
    background: '#fdf6e3',
    foreground: '#657b83',
    cursor: '#657b83',
    selectionBackground: 'rgba(238,232,213,0.9)',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
  monokai: {
    background: '#272822',
    foreground: '#f8f8f2',
    cursor: '#f8f8f0',
    selectionBackground: 'rgba(73,72,62,0.8)',
    black: '#272822',
    red: '#f92672',
    green: '#a6e22e',
    yellow: '#f4bf75',
    blue: '#66d9ef',
    magenta: '#ae81ff',
    cyan: '#a1efe4',
    white: '#f8f8f2',
    brightBlack: '#75715e',
    brightRed: '#f92672',
    brightGreen: '#a6e22e',
    brightYellow: '#f4bf75',
    brightBlue: '#66d9ef',
    brightMagenta: '#ae81ff',
    brightCyan: '#a1efe4',
    brightWhite: '#f9f8f5',
  },
}

export function getTerminalColors(
  t: Theme,
  colors?: CustomColors,
  palette: TerminalPaletteId = 'auto',
): Record<string, string> {
  if (palette !== 'auto' && presetPalettes[palette]) {
    return { ...presetPalettes[palette] }
  }
  if (t === 'custom' && colors) {
    const base = getLuminance(colors.bgColor) < 0.5 ? presetPalettes.dark : presetPalettes.light
    return {
      ...base,
      background: colors.bgColor,
      foreground: colors.fontColor,
    }
  }
  return { ...presetPalettes[t === 'custom' ? 'dark' : t] }
}

/** Protect colored text on colored backgrounds (for example ls 34;42) in light palettes. */
export function getTerminalMinimumContrastRatio(
  theme: Theme,
  colors?: CustomColors,
  palette: TerminalPaletteId = 'auto',
): number {
  const background = getTerminalColors(theme, colors, palette).background
  return getLuminance(background) >= 0.5 ? 4.5 : 1
}

export const KEYBOARD_SHORTCUTS: Array<{ keys: string; descKey: string; scopeKey: string; keysKey?: string }> = [
  { keys: 'Ctrl+/ / ?', keysKey: 'settingsShortcuts.keys.shortcutsHelp', descKey: 'settingsShortcuts.items.shortcutsHelp', scopeKey: 'settingsShortcuts.scopes.global' },
  { keys: 'Ctrl+B', descKey: 'settingsShortcuts.items.toggleSftp', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+Shift+A', descKey: 'settingsShortcuts.items.toggleAi', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+Shift+M', descKey: 'settingsShortcuts.items.toggleMonitor', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+Shift+B', descKey: 'settingsShortcuts.items.toggleBatch', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+Shift+S', descKey: 'settingsShortcuts.items.toggleSnippets', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+Shift+D', descKey: 'settingsShortcuts.items.toggleDocker', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+K', descKey: 'settingsShortcuts.items.snippetQuickRun', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+P', descKey: 'settingsShortcuts.items.commandPalette', scopeKey: 'settingsShortcuts.scopes.global' },
  { keys: 'Ctrl+Shift+T', descKey: 'settingsShortcuts.items.newSubSession', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+Tab', descKey: 'settingsShortcuts.items.nextSubSession', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+Shift+Tab', descKey: 'settingsShortcuts.items.prevSubSession', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+= / Ctrl+-', descKey: 'settingsShortcuts.items.fontZoom', scopeKey: 'settingsShortcuts.scopes.terminal' },
  { keys: 'Ctrl+F', descKey: 'settingsShortcuts.items.terminalSearch', scopeKey: 'settingsShortcuts.scopes.terminal' },
  { keys: 'Enter / Shift+Enter', descKey: 'settingsShortcuts.items.searchNav', scopeKey: 'settingsShortcuts.scopes.terminalSearch' },
  { keys: 'R', descKey: 'settingsShortcuts.items.reconnect', scopeKey: 'settingsShortcuts.scopes.reconnectOverlay' },
  { keys: 'Esc', descKey: 'settingsShortcuts.items.closeDialog', scopeKey: 'settingsShortcuts.scopes.global' },
  { keys: '', keysKey: 'theme.doubleClickConnect', descKey: 'settingsShortcuts.items.doubleClickConnect', scopeKey: 'settingsShortcuts.scopes.connections' },
  { keys: '/', descKey: 'settingsShortcuts.items.focusSearch', scopeKey: 'settingsShortcuts.scopes.connections' },
  { keys: '↑ / ↓ / Enter', descKey: 'settingsShortcuts.items.listNav', scopeKey: 'settingsShortcuts.scopes.connections' },
]
