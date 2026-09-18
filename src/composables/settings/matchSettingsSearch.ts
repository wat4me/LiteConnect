export function normalizeSettingsQuery(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '')
}

export interface SettingsSearchMatchInput {
  id: string
  title: string
  hint?: string
  tabLabel: string
  keywords?: string[]
}

export function matchSettingsSearch<T extends SettingsSearchMatchInput>(
  items: T[],
  query: string,
): T[] {
  const q = normalizeSettingsQuery(query)
  if (!q) return []

  const scored: Array<{ item: T; score: number }> = []
  for (const item of items) {
    const title = normalizeSettingsQuery(item.title)
    const hint = normalizeSettingsQuery(item.hint || '')
    const tab = normalizeSettingsQuery(item.tabLabel)
    const keys = (item.keywords || []).map(normalizeSettingsQuery)
    let score = 0
    if (title === q) score = 100
    else if (title.startsWith(q)) score = 80
    else if (title.includes(q)) score = 60
    else if (keys.some((k) => k.includes(q) || q.includes(k))) score = 50
    else if (tab.includes(q) || q.includes(tab)) score = 35
    else if (hint.includes(q)) score = 25
    if (score > 0) scored.push({ item, score })
  }

  scored.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'zh'))
  return scored.map((row) => row.item)
}
