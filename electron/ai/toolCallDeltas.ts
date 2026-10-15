export type AccumulatedToolCall = {
  id: string
  name: string
  arguments: string
}

export function accumulateToolCallDeltas(acc: Map<number, AccumulatedToolCall>, deltas: unknown): void {
  if (!Array.isArray(deltas)) return
  for (const raw of deltas) {
    if (!raw || typeof raw !== 'object') continue
    const d = raw as {
      index?: number
      id?: string
      function?: { name?: string; arguments?: string }
    }
    const idx = typeof d.index === 'number' ? d.index : acc.size
    const cur = acc.get(idx) || { id: '', name: '', arguments: '' }
    if (typeof d.id === 'string' && d.id) cur.id = d.id
    if (typeof d.function?.name === 'string') cur.name += d.function.name
    if (typeof d.function?.arguments === 'string') cur.arguments += d.function.arguments
    acc.set(idx, cur)
  }
}
