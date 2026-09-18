function trimDecimal(value: string): string {
  return value.replace(/\.0$/, '')
}

/** Compact large token counts without hiding useful precision. */
export function formatCompactTokenCount(value: number): string {
  const count = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
  if (count < 1_000) return String(count)
  if (count < 1_000_000) {
    const scaled = count / 1_000
    return `${trimDecimal(scaled.toFixed(scaled < 100 ? 1 : 0))}k`
  }
  const scaled = count / 1_000_000
  return `${trimDecimal(scaled.toFixed(scaled < 100 ? 1 : 0))}M`
}
