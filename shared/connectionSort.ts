export const CONNECTION_SORT_MODES = ['manual', 'recent', 'frequent'] as const

export type ConnectionSortMode = (typeof CONNECTION_SORT_MODES)[number]

export function normalizeConnectionSortMode(
  raw: unknown,
  usageStatsEnabled = true,
): ConnectionSortMode {
  const mode: ConnectionSortMode =
    typeof raw === 'string' && (CONNECTION_SORT_MODES as readonly string[]).includes(raw)
      ? raw as ConnectionSortMode
      : 'manual'
  return !usageStatsEnabled && mode !== 'manual' ? 'manual' : mode
}
