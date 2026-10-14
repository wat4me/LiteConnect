import type { AiWorkspaceTarget } from '@shared/aiWorkspace'

export type WorkspaceResponseSection = { text: string; title?: string; connectionId?: string }

/** Project host headings into disclosure sections without changing stored/model content. */
export function workspaceResponseSections(text: string, targets: AiWorkspaceTarget[]): WorkspaceResponseSection[] {
  if (targets.length < 2) return [{ text }]
  const sections: WorkspaceResponseSection[] = []
  let current: WorkspaceResponseSection = { text: '' }
  let hostLevel = 0
  let fence: { char: string; length: number } | undefined
  for (const line of text.match(/[^\n]*\n|[^\n]+$/g) || []) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)/.exec(line)
    if (marker) {
      if (!fence) fence = { char: marker[1][0], length: marker[1].length }
      else if (marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = undefined
      current.text += line
      continue
    }
    const heading = !fence && /^ {0,3}(#{1,3})\s+(.+?)\s*#*\s*$/.exec(line)
    if (heading) {
      const level = heading[1].length
      const title = heading[2].replace(/[`*_]/g, '').trim()
      const contains = (identity: string) => {
        if (!identity) return false
        const escaped = identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`(?<![\\p{L}\\p{N}_.-])${escaped}(?![\\p{L}\\p{N}_.-])`, 'u').test(title)
      }
      const addresses = targets.filter(target => contains(target.host))
      const matches = addresses.length ? addresses : targets.filter(target => contains(target.name))
      const target = level >= 2 && matches.length === 1 ? matches[0] : undefined
      if (target || (current.connectionId && level <= hostLevel)) {
        if (current.text || current.connectionId) sections.push(current)
        current = target ? { text: '', title, connectionId: target.connectionId } : { text: '' }
        hostLevel = target ? level : 0
        if (target) continue
      }
    }
    current.text += line
  }
  if (current.text || current.connectionId) sections.push(current)
  return sections.length ? sections : [{ text }]
}
