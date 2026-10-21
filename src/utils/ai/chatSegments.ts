import type { AiChatSegment } from '../../env.d'

/** A tool/question boundary seals the preceding content without ending the request. */
export function isLiveContentSegment(message: {
  streaming?: boolean
  segments?: AiChatSegment[]
  toolRuns?: Array<{ status?: string }>
}, index: number): boolean {
  if (!message.streaming) return false
  if (message.segments?.length) {
    return index === message.segments.length - 1 && message.segments[index].kind === 'content'
  }
  // Legacy/projected messages can have content but no recorded timeline.
  return !message.toolRuns?.some(run => run.status === 'ask' || run.status === 'question' || run.status === 'running')
}

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
