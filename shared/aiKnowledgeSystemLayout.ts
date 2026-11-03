import type { KnowledgeSystem } from './aiKnowledgeSystem'

/** Collapse cycles, then arrange dependency components in stable topological columns. */
export function layoutKnowledgeSystem(system: KnowledgeSystem) {
  const edges = new Map(system.nodes.map(node => [node.id, [] as string[]]))
  for (const edge of system.dependencies) if (edges.has(edge.from) && edges.has(edge.to)) edges.get(edge.from)!.push(edge.to)
  const visited = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], active = new Set<string>()
  const components: string[][] = []
  let index = 0
  function visit(id: string) {
    visited.set(id, index); low.set(id, index++); stack.push(id); active.add(id)
    for (const next of edges.get(id) || []) {
      if (!visited.has(next)) { visit(next); low.set(id, Math.min(low.get(id)!, low.get(next)!)) }
      else if (active.has(next)) low.set(id, Math.min(low.get(id)!, visited.get(next)!))
    }
    if (low.get(id) === visited.get(id)) {
      const component: string[] = []
      let next: string
      do { next = stack.pop()!; active.delete(next); component.push(next) } while (next !== id)
      components.push(component)
    }
  }
  for (const node of system.nodes) if (!visited.has(node.id)) visit(node.id)
  const owner = new Map(components.flatMap((component, i) => component.map(id => [id, i] as const)))
  const forward = components.map(() => new Set<number>()), incoming = components.map(() => 0), levels = components.map(() => 0)
  for (const [from, next] of edges) for (const to of next) {
    const a = owner.get(from)!, b = owner.get(to)!
    if (a !== b && !forward[a].has(b)) { forward[a].add(b); incoming[b]++ }
  }
  const queue = incoming.flatMap((count, i) => count ? [] : [i])
  for (let i = 0; i < queue.length; i++) for (const next of forward[queue[i]]) {
    levels[next] = Math.max(levels[next], levels[queue[i]] + 1)
    if (!--incoming[next]) queue.push(next)
  }
  const rows = new Map<number, number>()
  const nodes = system.nodes.map(node => {
    const column = levels[owner.get(node.id)!], row = rows.get(column) || 0
    rows.set(column, row + 1)
    return { ...node, x: 24 + column * 220, y: 24 + row * 126 }
  })
  return { nodes, width: Math.max(570, 48 + (Math.max(0, ...levels) + 1) * 220), height: Math.max(160, 48 + Math.max(0, ...rows.values()) * 126) }
}
