import type { GridSort } from './types'

export function cellValue(row: Record<string, unknown>, col: string): unknown {
  return row[col]
}

export function isNullCell(row: Record<string, unknown>, col: string): boolean {
  return row[col] === null || row[col] === undefined
}

export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

export function formatRows(n: number | null): string {
  if (n == null || Number.isNaN(n)) return ''
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

export function keyBadge(key: string): string {
  if (key === 'PRI') return 'PK'
  if (key === 'UNI') return 'UQ'
  if (key === 'MUL') return 'IDX'
  return ''
}

export function isBlobPlaceholder(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('<BLOB ')
}

export function sortIndicator(sort: GridSort, col: string): string {
  if (!sort || sort.col !== col) return ''
  return sort.dir === 'asc' ? ' ↑' : ' ↓'
}

export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = typeof value === 'object' ? formatCell(value) : String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

export function resultToCsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.map(csvEscape).join(',')]
  for (const row of rows) {
    lines.push(columns.map((c) => csvEscape(row[c])).join(','))
  }
  return lines.join('\r\n')
}

export function resultToTsv(columns: string[], rows: Record<string, unknown>[]): string {
  const lines = [columns.join('\t')]
  for (const row of rows) {
    lines.push(columns.map((c) => formatCell(row[c])).join('\t'))
  }
  return lines.join('\n')
}

export function downloadTextFile(filename: string, content: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\uFEFF' + content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function formatHistoryTime(at: number) {
  const d = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
