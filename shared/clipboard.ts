/** Length is measured in JavaScript UTF-16 code units, consistently across IPC. */
export const CLIPBOARD_MAX_CHARS = 2 * 1024 * 1024
export const CLIPBOARD_TOO_LARGE_ERROR = 'CLIPBOARD_TEXT_TOO_LARGE'

export function validateClipboardRead(text: string): string {
  if (text.length > CLIPBOARD_MAX_CHARS) throw new Error(CLIPBOARD_TOO_LARGE_ERROR)
  return text
}
