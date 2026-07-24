import type { DockerContainerSummary } from '../../env.d'

export type DockerListStateFilter = 'all' | 'running' | 'stopped'

/** States treated as "stopped" for MVP filter (not running). */
const STOPPED_STATES = new Set(['exited', 'created', 'dead', 'removing', 'paused'])

/**
 * Whether a container matches the state filter.
 * - running: only state === 'running'
 * - stopped: exited | created | dead | removing | paused (and non-running unknowns excluded from running)
 * - all: everything
 * Unknown states: visible under "all" only (not running, not stopped).
 */
export function matchesStateFilter(
  container: Pick<DockerContainerSummary, 'state'>,
  filter: DockerListStateFilter,
): boolean {
  const state = (container.state || '').toLowerCase()
  if (filter === 'all') return true
  if (filter === 'running') return state === 'running'
  // stopped
  if (STOPPED_STATES.has(state)) return true
  return false
}

/** Case-insensitive match on displayName, all names, and image. */
export function matchesSearch(
  container: Pick<DockerContainerSummary, 'displayName' | 'names' | 'image'>,
  search: string,
): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  if (container.displayName.toLowerCase().includes(q)) return true
  if (container.image.toLowerCase().includes(q)) return true
  for (const n of container.names) {
    if (n.toLowerCase().includes(q)) return true
  }
  return false
}

export function filterContainers(
  list: DockerContainerSummary[],
  state: DockerListStateFilter,
  search: string,
): DockerContainerSummary[] {
  return list.filter((c) => matchesStateFilter(c, state) && matchesSearch(c, search))
}

/** Keep selection by id if still present; otherwise clear. */
export function resolveSelectionAfterRefresh(
  previousId: string | null,
  nextList: DockerContainerSummary[],
): string | null {
  if (!previousId) return null
  return nextList.some((c) => c.id === previousId) ? previousId : null
}

/** Case-insensitive substring search in inspect JSON text. */
export function inspectJsonMatches(inspectJson: string, query: string): boolean {
  const q = query.trim()
  if (!q) return true
  return inspectJson.toLowerCase().includes(q.toLowerCase())
}

/** Compact port line for list UI. */
export function formatContainerPortsSummary(
  ports: { ip: string; privatePort: number; publicPort: number | null; type: string }[],
): string {
  if (!ports.length) return ''
  return ports
    .map((p) => {
      if (p.publicPort != null) {
        const host = p.ip && p.ip !== '0.0.0.0' && p.ip !== '::' ? `${p.ip}:` : ''
        return `${host}${p.publicPort}→${p.privatePort}/${p.type}`
      }
      return `${p.privatePort}/${p.type}`
    })
    .join(', ')
}
