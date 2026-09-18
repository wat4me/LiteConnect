/** Single-line paste confirm threshold options; multiline always confirms when master switch is on. */
export const TERMINAL_PASTE_CONFIRM_MAX_CHARS_OPTIONS = [100, 200, 400, 800, 1600] as const
export type TerminalPasteConfirmMaxChars = (typeof TERMINAL_PASTE_CONFIRM_MAX_CHARS_OPTIONS)[number]
export const DEFAULT_TERMINAL_PASTE_CONFIRM_MAX_CHARS = 400

/** Sanitize persisted / IPC threshold; corrupt/legacy → 400. */
export function sanitizeTerminalPasteConfirmMaxChars(n: unknown): TerminalPasteConfirmMaxChars {
  if (
    typeof n === 'number'
    && (TERMINAL_PASTE_CONFIRM_MAX_CHARS_OPTIONS as readonly number[]).includes(n)
  ) {
    return n as TerminalPasteConfirmMaxChars
  }
  return DEFAULT_TERMINAL_PASTE_CONFIRM_MAX_CHARS
}
