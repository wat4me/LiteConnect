export function shellQuote(value: string): string {
  return "'" + String(value).replace(/'/g, "'\\''") + "'"
}
