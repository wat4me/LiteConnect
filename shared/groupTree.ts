import type { Group } from './types/connection'

export interface GroupTreeEntry {
  group: Group
  depth: number
}

/** An iterative tree index: legacy roots, orphans and damaged cycles remain visible. */
export function buildGroupTree(groups: readonly Group[]) {
  const byId = new Map(groups.map(group => [group.id, group]))
  const parents = new Map<string, string | null>()
  for (const group of groups) {
    parents.set(group.id, typeof group.parentId === 'string'
      && group.parentId !== group.id && byId.has(group.parentId) ? group.parentId : null)
  }
  const checked = new Set<string>()
  for (const group of groups) {
    const path = new Set<string>()
    let id: string | null = group.id
    while (id && !checked.has(id)) {
      if (path.has(id)) {
        parents.set(id, null)
        break
      }
      path.add(id)
      id = parents.get(id) ?? null
    }
    for (const visited of path) checked.add(visited)
  }
  const children = new Map<string | null, Group[]>()
  for (const group of [...byId.values()].sort((a, b) => a.order - b.order)) {
    const parentId = parents.get(group.id) ?? null
    const siblings = children.get(parentId) || []
    siblings.push(group)
    children.set(parentId, siblings)
  }
  const rows: GroupTreeEntry[] = []
  const pending = (children.get(null) || []).map(group => ({ group, depth: 0 })).reverse()
  while (pending.length) {
    const entry = pending.pop()!
    rows.push(entry)
    const nested = children.get(entry.group.id) || []
    for (let index = nested.length - 1; index >= 0; index--) {
      pending.push({ group: nested[index], depth: entry.depth + 1 })
    }
  }
  function getAncestors(id: string): Group[] {
    const ancestors: Group[] = []
    let parent = parents.get(id)
    while (parent) {
      ancestors.push(byId.get(parent)!)
      parent = parents.get(parent)
    }
    return ancestors.reverse()
  }
  function getSubtreeIds(id: string): Set<string> {
    const ids = new Set<string>()
    const pendingIds = byId.has(id) ? [id] : []
    while (pendingIds.length) {
      const current = pendingIds.pop()!
      ids.add(current)
      for (const child of children.get(current) || []) pendingIds.push(child.id)
    }
    return ids
  }
  function getPath(id: string): string {
    const group = byId.get(id)
    return group ? [...getAncestors(id), group].map(item => item.name).join(' / ') : ''
  }
  return { byId, children, rows, getAncestors, getSubtreeIds, getPath,
    getParentId: (id: string) => parents.get(id) ?? null }
}
