import { t } from '../i18n'

/** Default row accent when no color tag is set (replaces the old idle status dot). */
export const DEFAULT_CONNECTION_TAG_COLOR = '#8b949e'

const CONNECTION_COLOR_TAG_DEFS = [
  { id: '', color: DEFAULT_CONNECTION_TAG_COLOR, labelKey: 'connections.colorTagDefault' },
  { id: 'gray', color: '#8b949e', labelKey: 'connectionTags.gray' },
  { id: 'blue', color: '#58a6ff', labelKey: 'connectionTags.blue' },
  { id: 'green', color: '#3fb950', labelKey: 'connectionTags.green' },
  { id: 'yellow', color: '#d29922', labelKey: 'connectionTags.yellow' },
  { id: 'orange', color: '#db6d28', labelKey: 'connectionTags.orange' },
  { id: 'red', color: '#f85149', labelKey: 'connectionTags.red' },
  { id: 'purple', color: '#bc8cff', labelKey: 'connectionTags.purple' },
] as const

export type ConnectionColorTagId = (typeof CONNECTION_COLOR_TAG_DEFS)[number]['id']

/** Labels resolved via i18n at access time. */
export const CONNECTION_COLOR_TAGS = CONNECTION_COLOR_TAG_DEFS.map((def) => ({
  id: def.id,
  color: def.color,
  get label() {
    return t(def.labelKey)
  },
}))

/** Resolved color for list/tab display; empty tag → default gray. */
export function getConnectionTagColor(tag?: string | null): string {
  if (!tag) return DEFAULT_CONNECTION_TAG_COLOR
  const found = CONNECTION_COLOR_TAG_DEFS.find((x) => x.id === tag)
  return found?.color || DEFAULT_CONNECTION_TAG_COLOR
}
