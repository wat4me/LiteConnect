/** Live Ctrl+= / Ctrl+- range; matches settings page clamps. */
export const TERMINAL_FONT_SIZE_MIN = 10
export const TERMINAL_FONT_SIZE_MAX = 24

export function stepTerminalFontSize(current: number, delta: number): number {
  const next = current + delta
  if (!Number.isFinite(next)) return current
  return Math.min(TERMINAL_FONT_SIZE_MAX, Math.max(TERMINAL_FONT_SIZE_MIN, next))
}

function hasZoomModifier(e: { ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
  return (e.ctrlKey || e.metaKey) && !e.altKey
}

/** Ctrl/Cmd + = / + / numpad+ (Shift+= is the usual physical + key). */
export function isTerminalFontZoomInKey(e: {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): boolean {
  if (!hasZoomModifier(e)) return false
  return e.key === '=' || e.key === '+' || e.key === 'Add' || e.code === 'Equal' || e.code === 'NumpadAdd'
}

/** Ctrl/Cmd + - / _ / numpad- */
export function isTerminalFontZoomOutKey(e: {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): boolean {
  if (!hasZoomModifier(e)) return false
  return e.key === '-' || e.key === '_' || e.key === 'Subtract' || e.code === 'Minus' || e.code === 'NumpadSubtract'
}

/**
 * Chromium/Electron page-zoom shortcuts. These must preventDefault or the whole
 * SSH chrome (fixed 30px bars, xterm canvas) scales and looks broken.
 */
export function isBrowserPageZoomKey(e: {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}): boolean {
  if (!hasZoomModifier(e)) return false
  if (isTerminalFontZoomInKey(e) || isTerminalFontZoomOutKey(e)) return true
  return e.key === '0' || e.code === 'Digit0' || e.code === 'Numpad0'
}
