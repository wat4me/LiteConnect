const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** Compact byte size. Values under 10 of a unit keep one decimal; larger values round. */
export function formatBytes(bytes: number): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  let value = n
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const text = unit > 0 && value < 10 ? value.toFixed(1) : String(Math.round(value))
  return `${text} ${UNITS[unit]}`
}
