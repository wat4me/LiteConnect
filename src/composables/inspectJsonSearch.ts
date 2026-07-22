/** Inclusive start, exclusive end — plain-text match (no RegExp). */
export type InspectMatchRange = {
  start: number
  end: number
}

export type InspectTextSegment =
  | { kind: 'text'; text: string }
  | { kind: 'match'; text: string; matchIndex: number }

/**
 * Case-insensitive plain-text matches. Query is never compiled as RegExp
 * (special chars like .*+? are literal).
 * Non-overlapping left-to-right scan.
 */
export function findInspectMatches(text: string, query: string): InspectMatchRange[] {
  const q = query.trim()
  if (!q || !text) return []
  const hay = text.toLowerCase()
  const needle = q.toLowerCase()
  if (!needle) return []

  const matches: InspectMatchRange[] = []
  let from = 0
  while (from <= hay.length - needle.length) {
    const idx = hay.indexOf(needle, from)
    if (idx < 0) break
    matches.push({ start: idx, end: idx + needle.length })
    from = idx + needle.length
  }
  return matches
}

/** Split source into plain text + match segments for safe VNode rendering (no v-html). */
export function buildInspectSegments(
  text: string,
  matches: InspectMatchRange[],
): InspectTextSegment[] {
  if (!text) return []
  if (!matches.length) return [{ kind: 'text', text }]

  const segs: InspectTextSegment[] = []
  let cursor = 0
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]
    if (m.start < cursor) continue
    if (m.start > cursor) {
      segs.push({ kind: 'text', text: text.slice(cursor, m.start) })
    }
    segs.push({
      kind: 'match',
      text: text.slice(m.start, m.end),
      matchIndex: i,
    })
    cursor = m.end
  }
  if (cursor < text.length) {
    segs.push({ kind: 'text', text: text.slice(cursor) })
  }
  return segs
}

/** Next match with wrap-around; no-op when total is 0. */
export function nextInspectMatchIndex(current: number, total: number): number {
  if (total <= 0) return 0
  if (!Number.isFinite(current) || current < 0) return 0
  return (Math.floor(current) + 1) % total
}

/** Previous match with wrap-around. */
export function prevInspectMatchIndex(current: number, total: number): number {
  if (total <= 0) return 0
  if (!Number.isFinite(current) || current < 0) return total - 1
  return (Math.floor(current) - 1 + total) % total
}

/** Active index after query / inspect document change (always first match or 0). */
export function resetInspectMatchIndex(matchCount: number): number {
  return matchCount > 0 ? 0 : 0
}

/** 1-based display position for UI ("3 / 12"); 0 when no matches. */
export function inspectMatchDisplay(current: number, total: number): { current: number; total: number } {
  if (total <= 0) return { current: 0, total: 0 }
  const c = Math.min(Math.max(0, Math.floor(current)), total - 1)
  return { current: c + 1, total }
}
