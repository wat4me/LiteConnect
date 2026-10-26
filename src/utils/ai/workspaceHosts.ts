import type { Connection, Group } from '@shared/types/connection'
import { i18n } from '@/i18n'
import { buildGroupTree } from '@shared/groupTree'

export function groupAiWorkspaceHosts(hostsToGroup: Connection[], groups: Group[], options: { connectedFirst: boolean; sessions: Readonly<Record<string, string>>; unknownGroup: string; ungrouped: string }) {
  const sections: { id: string; name: string; hosts: Connection[] }[] = []
  const byGroup = new Map<string, Connection[]>()
  const compareHosts = (a: Connection, b: Connection) =>
    Number(b.pinned === true) - Number(a.pinned === true) ||
    (options.connectedFirst ? Number(!!options.sessions[b.id]) - Number(!!options.sessions[a.id]) : 0) ||
    (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, i18n.global.locale.value)
  for (const connection of hostsToGroup) {
    const id = connection.group || ''
    const list = byGroup.get(id) || []
    list.push(connection)
    byGroup.set(id, list)
  }
  const tree = buildGroupTree(groups)
  for (const { group } of tree.rows) {
    const hosts = byGroup.get(group.id)
    if (!hosts?.length) continue
    sections.push({ id: group.id, name: tree.getPath(group.id), hosts: hosts.sort(compareHosts) })
    byGroup.delete(group.id)
  }
  for (const [id, hosts] of byGroup) {
    sections.push({
      id: id || '__ungrouped__',
      name: id ? options.unknownGroup : options.ungrouped,
      hosts: hosts.sort(compareHosts),
    })
  }
  return sections
}
