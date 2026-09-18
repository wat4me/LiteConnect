import type { AiChatSegment } from '../../env.d'

/** Append a streamed reasoning/content delta to the display timeline. */
export function appendTextSegment(
  segments: AiChatSegment[] | undefined,
  kind: 'reasoning' | 'content',
  delta: string,
): AiChatSegment[] {
  const list = segments || []
  const last = list[list.length - 1]
  if (last && last.kind === kind) {
    last.text += delta
    return list
  }
  list.push({ kind, text: delta })
  return list
}

/**
 * Place each tool run on the timeline where it arrived.
 * Missing entries append at the tail — never rewind past already-streamed content.
 */
export function ensureToolSegments(
  segments: AiChatSegment[] | undefined,
  toolRuns: Array<{ id: string }> | undefined,
): AiChatSegment[] | undefined {
  if (!toolRuns?.length) return segments
  const out = segments || []
  const missing = toolRuns.filter((run) => !out.some((seg) => seg.kind === 'tool' && seg.runId === run.id))
  if (!missing.length) return segments || out
  for (const run of missing) {
    out.push({ kind: 'tool', runId: run.id })
  }
  return out
}
