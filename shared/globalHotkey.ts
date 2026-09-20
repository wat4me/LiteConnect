/**
 * Global "show/hide window" hotkey as an Electron globalShortcut accelerator.
 * Shared by the settings UI (keyboard capture + validation) and the main
 * process (register / unregister), so both sides agree on the canonical form.
 */

/** Historical default, kept as the fallback for missing/invalid values. */
export const DEFAULT_GLOBAL_HOTKEY = 'Alt+Shift+L'

/** Canonical modifier order used when rebuilding an accelerator string. */
const MODIFIER_ORDER = ['Ctrl', 'CmdOrCtrl', 'Alt', 'Shift', 'Cmd', 'Super', 'Meta'] as const

const MODIFIER_ALIASES: Record<string, string> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  cmdorctrl: 'CmdOrCtrl',
  commandorcontrol: 'CmdOrCtrl',
  cmd: 'Cmd',
  command: 'Cmd',
  super: 'Super',
  meta: 'Meta',
  option: 'Alt',
  alt: 'Alt',
  shift: 'Shift',
}

const NAMED_KEYS: Record<string, string> = {
  space: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  del: 'Delete',
  insert: 'Insert',
  return: 'Return',
  enter: 'Return',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  escape: 'Escape',
  esc: 'Escape',
  printscreen: 'PrintScreen',
  plus: 'Plus',
}

/** KeyboardEvent.code → accelerator key name (US-layout base key). */
const CODE_TO_KEY: Record<string, string> = {
  Space: 'Space',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  NumpadAdd: 'Plus',
  NumpadSubtract: '-',
  NumpadMultiply: '*',
  NumpadDivide: '/',
  NumpadDecimal: '.',
}

/** KeyboardEvent.key → accelerator key name. */
const KEY_TO_KEY: Record<string, string> = {
  ...NAMED_KEYS,
  ' ': 'Space',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
}

/** Minimal shape of a keydown event (keeps this module DOM-free). */
export type HotkeyKeyEvent = {
  key: string
  code?: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

const F_KEY_RE = /^F([1-9]|1[0-9]|2[0-4])$/i
const PRINTABLE_ASCII_RE = /^[!-~]$/

function isMacPlatform(platform?: string): boolean {
  return typeof platform === 'string' && /mac|darwin/i.test(platform)
}

/** Uppercased single alnum key, F-key, named key, or printable ASCII punctuation. */
function canonicalMainKey(raw: string): string | null {
  const part = raw.trim()
  if (!part) return null
  const lower = part.toLowerCase()
  if (lower in NAMED_KEYS) return NAMED_KEYS[lower]
  if (F_KEY_RE.test(part)) return part.toUpperCase()
  if (/^[a-z0-9]$/i.test(part)) return part.toUpperCase()
  if (part.length === 1 && PRINTABLE_ASCII_RE.test(part)) return part === '+' ? 'Plus' : part
  return null
}

/**
 * Validate and canonicalize an accelerator such as `Ctrl+Alt+Shift+L`.
 * Returns null when it lacks a modifier or the single main key, so callers can
 * fall back to {@link DEFAULT_GLOBAL_HOTKEY} instead of registering garbage.
 */
export function normalizeGlobalHotkey(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const parts = raw
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length < 2) return null

  const mods = new Set<string>()
  let main: string | null = null
  for (const part of parts) {
    const alias = MODIFIER_ALIASES[part.toLowerCase()]
    if (alias) {
      mods.add(alias)
      continue
    }
    if (main !== null) return null // two main keys
    main = canonicalMainKey(part)
    if (!main) return null
  }
  if (!main || mods.size === 0) return null

  const ordered = MODIFIER_ORDER.filter((m) => mods.has(m))
  return [...ordered, main].join('+')
}

/** Map a keydown to an accelerator, or null while only modifiers are held. */
export function keyEventToAccelerator(event: HotkeyKeyEvent, platform?: string): string | null {
  const mods: string[] = []
  if (event.ctrlKey) mods.push('Ctrl')
  if (event.altKey) mods.push('Alt')
  if (event.shiftKey) mods.push('Shift')
  if (event.metaKey) mods.push(isMacPlatform(platform) ? 'Cmd' : 'Super')

  const code = event.code ?? ''
  let main: string | null = null
  const letterOrDigit = /^(?:Key|Digit)([A-Z0-9])$/.exec(code)
  if (letterOrDigit) {
    // Prefer code over key so a QWERTZ/Dvorak layout still yields the physical key
    main = letterOrDigit[1]
  } else if (F_KEY_RE.test(code)) {
    main = code.toUpperCase()
  } else if (code in CODE_TO_KEY) {
    main = CODE_TO_KEY[code]
  } else if (event.key in KEY_TO_KEY) {
    main = KEY_TO_KEY[event.key]
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(event.key)) {
    main = event.key.toUpperCase()
  } else if (event.key.length === 1 && PRINTABLE_ASCII_RE.test(event.key)) {
    main = event.key === '+' ? 'Plus' : event.key.toUpperCase()
  }

  if (!main || mods.length === 0) return null
  const ordered = MODIFIER_ORDER.filter((m) => mods.includes(m))
  return [...ordered, main].join('+')
}
