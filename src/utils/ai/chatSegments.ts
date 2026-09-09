import type { AiChatSegment } from '../../env.d'

/** Append a streamed reasoning/content delta to the display timeline. */
export function appendTextSegment(
  segments: AiChatSegment[] | undefined,
  kind: 'reasoning' | 'content',
  delta: string,
): AiChatSegment[] {
  const out = [...(segments || [])]
  const last = out[out.length - 1]
  if (last && last.kind === kind) {
    out[out.length - 1] = { kind, text: last.text + delta }
  } else {
    out.push({ kind, text: delta })
  }
  return out
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
  const out = [...(segments || [])]
  const missing = toolRuns.filter((run) => !out.some((seg) => seg.kind === 'tool' && seg.runId === run.id))
  if (!missing.length) return segments
  for (const run of missing) {
    out.push({ kind: 'tool', runId: run.id })
  }
  return out
}
