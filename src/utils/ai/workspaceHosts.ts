import type { Connection, Group } from '@shared/types/connection'

export function groupAiWorkspaceHosts(hostsToGroup: Connection[], groups: Group[], options: { connectedFirst: boolean; sessions: Readonly<Record<string, string>>; unknownGroup: string; ungrouped: string }) {
  const sections: { id: string; name: string; hosts: Connection[] }[] = []
  const byGroup = new Map<string, Connection[]>()
  const compareHosts = (a: Connection, b: Connection) =>
    Number(b.pinned === true) - Number(a.pinned === true) ||
    (options.connectedFirst ? Number(!!options.sessions[b.id]) - Number(!!options.sessions[a.id]) : 0) ||
    (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name, 'zh-CN')
  for (const connection of hostsToGroup) {
    const id = connection.group || ''
    const list = byGroup.get(id) || []
    list.push(connection)
    byGroup.set(id, list)
  }
  const ordered = [...groups].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'zh-CN'))
  for (const group of ordered) {
    const hosts = byGroup.get(group.id)
    if (!hosts?.length) continue
    sections.push({ id: group.id, name: group.name, hosts: hosts.sort(compareHosts) })
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
