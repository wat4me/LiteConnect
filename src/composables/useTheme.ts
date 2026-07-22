import { computed, ref } from 'vue'
import { t } from '../i18n'

export type Theme = 'dark' | 'light' | 'eyecare' | 'custom'

export interface CustomColors {
  fontColor: string
  bgColor: string
}

const THEME_KEY = 'liteconnect-theme'
const CUSTOM_COLORS_KEY = 'liteconnect-custom-colors'

const themeOrder: Theme[] = ['dark', 'light', 'eyecare', 'custom']

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
  return { fontColor: '#e6edf3', bgColor: '#0d1117' }
}

const CUSTOM_CSS_VARS = [
  '--bg-primary', '--bg-secondary', '--bg-tertiary', '--border-color',
  '--text-primary', '--text-secondary', '--accent', '--accent-hover',
  '--accent-bg', '--danger', '--success', '--warning',
  '--scrollbar-thumb', '--scrollbar-thumb-hover', '--overlay-bg',
  '--hover-bg', '--selection-bg', '--titlebar-bg', '--titlebar-symbol',
]

function clearCustomVars() {
  const root = document.documentElement
  for (const v of CUSTOM_CSS_VARS) {
    root.style.removeProperty(v)
  }
}

function applyCustomColors(colors: CustomColors) {
  const { fontColor, bgColor } = colors
  const root = document.documentElement
  root.setAttribute('data-theme', 'custom')

  const isDark = getLuminance(bgColor) < 0.5
  const accent = isDark ? '#58a6ff' : '#0969da'
  const accentHover = isDark ? '#79c0ff' : '#0550ae'

  root.style.setProperty('--bg-primary', bgColor)
  root.style.setProperty('--bg-secondary', mixColors(bgColor, fontColor, isDark ? 0.08 : 0.04))
  root.style.setProperty('--bg-tertiary', mixColors(bgColor, fontColor, isDark ? 0.15 : 0.08))
  root.style.setProperty('--border-color', mixColors(bgColor, fontColor, isDark ? 0.2 : 0.15))
  root.style.setProperty('--text-primary', fontColor)
  root.style.setProperty('--text-secondary', mixColors(fontColor, bgColor, isDark ? 0.4 : 0.45))
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-hover', accentHover)
  root.style.setProperty('--accent-bg', isDark ? 'rgba(88,166,255,0.1)' : 'rgba(9,105,218,0.08)')
  root.style.setProperty('--danger', isDark ? '#f85149' : '#cf222e')
  root.style.setProperty('--success', isDark ? '#3fb950' : '#1a7f37')
  root.style.setProperty('--warning', isDark ? '#d29922' : '#9a6700')
  root.style.setProperty('--scrollbar-thumb', mixColors(bgColor, fontColor, isDark ? 0.2 : 0.15))
  root.style.setProperty('--scrollbar-thumb-hover', mixColors(bgColor, fontColor, isDark ? 0.3 : 0.22))
  root.style.setProperty('--overlay-bg', isDark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.4)')
  root.style.setProperty('--hover-bg', isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)')
  root.style.setProperty('--selection-bg', isDark ? 'rgba(88,166,255,0.3)' : 'rgba(9,105,218,0.2)')
  root.style.setProperty('--titlebar-bg', bgColor)
  root.style.setProperty('--titlebar-symbol', mixColors(fontColor, bgColor, 0.5))

  try {
    const titleBarColors = { color: bgColor, symbolColor: mixColors(fontColor, bgColor, 0.5) }
    window.LiteConnect?.updateTitleBar('custom', titleBarColors)
  } catch {}
}

function applyPresetTheme(t: 'dark' | 'light' | 'eyecare') {
  clearCustomVars()
  document.documentElement.setAttribute('data-theme', t)
  localStorage.setItem(THEME_KEY, t)
  try {
    window.LiteConnect?.updateTitleBar(t)
  } catch {}
}

const currentTheme = ref<Theme>((localStorage.getItem(THEME_KEY) as Theme) || 'dark')
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

if (currentTheme.value === 'custom') {
  applyCustomColors(customColors.value)
} else {
  applyPresetTheme(currentTheme.value as 'dark' | 'light' | 'eyecare')
}

export function useTheme() {
  function setTheme(next: Theme) {
    applyTheme(next)
  }

  const themeLabels = computed<Record<Theme, string>>(() => ({
    dark: t('theme.dark'),
    light: t('theme.light'),
    eyecare: t('theme.eyecare'),
    custom: t('theme.custom'),
  }))

  return {
    theme: currentTheme,
    customColors,
    setTheme,
    setCustomColors,
    themeOrder,
    themeLabels,
  }
}

export type TerminalPaletteId =
  | 'auto'
  | 'dark'
  | 'light'
  | 'eyecare'
  | 'dracula'
  | 'solarized-dark'
  | 'solarized-light'
  | 'monokai'

export const terminalPaletteOrder: TerminalPaletteId[] = [
  'auto',
  'dark',
  'light',
  'eyecare',
  'dracula',
  'solarized-dark',
  'solarized-light',
  'monokai',
]

export const terminalPaletteLabels: Record<TerminalPaletteId, string> = new Proxy(
  {
    auto: '',
    dark: 'GitHub Dark',
    light: 'GitHub Light',
    eyecare: '',
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

export const terminalFontFamilyPresets: Array<{ id: string; label: string; value: string }> = [
  { id: 'cascadia', label: 'Cascadia Code', value: 'Cascadia Code, Fira Code, Consolas, Courier New, monospace' },
  { id: 'fira', label: 'Fira Code', value: 'Fira Code, Cascadia Code, Consolas, Courier New, monospace' },
  { id: 'jetbrains', label: 'JetBrains Mono', value: 'JetBrains Mono, Cascadia Code, Consolas, monospace' },
  { id: 'consolas', label: 'Consolas', value: 'Consolas, Courier New, monospace' },
  { id: 'source', label: 'Source Code Pro', value: 'Source Code Pro, Consolas, monospace' },
  { id: 'system', label: '', value: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' },
]

// Resolve system font label at access time via getter on the array item
Object.defineProperty(terminalFontFamilyPresets[terminalFontFamilyPresets.length - 1], 'label', {
  get: () => t('theme.fontSystem'),
  enumerable: true,
})

const presetPalettes: Record<string, Record<string, string>> = {
  dark: {
    background: '#0d1117',
    foreground: '#e6edf3',
    cursor: '#58a6ff',
    selectionBackground: 'rgba(88,166,255,0.3)',
    black: '#0d1117',
    red: '#ff7b72',
    green: '#3fb950',
    yellow: '#d29922',
    blue: '#58a6ff',
    magenta: '#bc8cff',
    cyan: '#39c5cf',
    white: '#e6edf3',
    brightBlack: '#8b949e',
    brightRed: '#ffa198',
    brightGreen: '#56d364',
    brightYellow: '#e3b341',
    brightBlue: '#79c0ff',
    brightMagenta: '#d2a8ff',
    brightCyan: '#56d4dd',
    brightWhite: '#ffffff',
  },
  light: {
    background: '#ffffff',
    foreground: '#1f2328',
    cursor: '#0969da',
    selectionBackground: 'rgba(9,105,218,0.2)',
    black: '#1f2328',
    red: '#cf222e',
    green: '#1a7f37',
    yellow: '#9a6700',
    blue: '#0969da',
    magenta: '#8250df',
    cyan: '#0b7570',
    white: '#656d76',
    brightBlack: '#6e7781',
    brightRed: '#a40e26',
    brightGreen: '#116329',
    brightYellow: '#845306',
    brightBlue: '#0550ae',
    brightMagenta: '#6e40c9',
    brightCyan: '#06615f',
    brightWhite: '#24292f',
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
  return { ...(presetPalettes[t] || presetPalettes.dark) }
}

export const KEYBOARD_SHORTCUTS: Array<{ keys: string; descKey: string; scopeKey: string; keysKey?: string }> = [
  { keys: 'Ctrl+B', descKey: 'settingsShortcuts.items.toggleSftp', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+Shift+A', descKey: 'settingsShortcuts.items.toggleAi', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+Shift+M', descKey: 'settingsShortcuts.items.toggleMonitor', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+Shift+B', descKey: 'settingsShortcuts.items.toggleBatch', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+Shift+S', descKey: 'settingsShortcuts.items.toggleSnippets', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+K', descKey: 'settingsShortcuts.items.snippetQuickRun', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+P', descKey: 'settingsShortcuts.items.commandPalette', scopeKey: 'settingsShortcuts.scopes.global' },
  { keys: 'Ctrl+Shift+T', descKey: 'settingsShortcuts.items.newSubSession', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+Tab', descKey: 'settingsShortcuts.items.nextSubSession', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+Shift+Tab', descKey: 'settingsShortcuts.items.prevSubSession', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+W', descKey: 'settingsShortcuts.items.closeTab', scopeKey: 'settingsShortcuts.scopes.workspace' },
  { keys: 'Ctrl+= / Ctrl+-', descKey: 'settingsShortcuts.items.fontZoom', scopeKey: 'settingsShortcuts.scopes.terminal' },
  { keys: 'Ctrl+F', descKey: 'settingsShortcuts.items.terminalSearch', scopeKey: 'settingsShortcuts.scopes.terminal' },
  { keys: 'Enter / Shift+Enter', descKey: 'settingsShortcuts.items.searchNav', scopeKey: 'settingsShortcuts.scopes.terminalSearch' },
  { keys: 'R', descKey: 'settingsShortcuts.items.reconnect', scopeKey: 'settingsShortcuts.scopes.reconnectOverlay' },
  { keys: 'Esc', descKey: 'settingsShortcuts.items.closeDialog', scopeKey: 'settingsShortcuts.scopes.global' },
  { keys: '', keysKey: 'theme.doubleClickConnect', descKey: 'settingsShortcuts.items.doubleClickConnect', scopeKey: 'settingsShortcuts.scopes.connections' },
  { keys: '/', descKey: 'settingsShortcuts.items.focusSearch', scopeKey: 'settingsShortcuts.scopes.connections' },
  { keys: '↑ / ↓ / Enter', descKey: 'settingsShortcuts.items.listNav', scopeKey: 'settingsShortcuts.scopes.connections' },
]