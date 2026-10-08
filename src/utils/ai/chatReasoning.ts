/** Visible tail of a live reasoning stream — one line, newest text wins. */
export const REASONING_LIVE_SNIPPET_MAX = 40

/** No new model text has arrived yet, including between tool rounds. */
export function isAwaitingModelReply(message: {
  streaming?: boolean
  content?: string
  reasoningContent?: string
  segments?: Array<{ kind: string }>
  toolRuns?: Array<{ status?: string; content?: string }>
}): boolean {
  if (!message.streaming) return false
  if (message.toolRuns?.some(run =>
    run.status === 'ask' || run.status === 'running' || (!run.status && !run.content),
  )) return false
  const segments = message.segments
  const lastSegment = segments?.length ? segments[segments.length - 1] : undefined
  if (lastSegment) return lastSegment.kind === 'tool'
  return !message.content && (!message.reasoningContent || !!message.toolRuns?.length)
}

export function reasoningLiveSnippet(text: string, maxLen = REASONING_LIVE_SNIPPET_MAX): string {
  const lines = String(text || '').split(/\r?\n/)
  let last = ''
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].replace(/\s+/g, ' ').trim()
    if (line) {
      last = line
      break
    }
  }
  if (!last) return ''
  if (last.length <= maxLen) return last
  return `…${last.slice(-maxLen)}`
}

/** True while this reasoning block is still the live tail of a streaming reply. */
export function isLiveReasoningSegment(
  message: {
    streaming?: boolean
    content?: string
    reasoningContent?: string
    segments?: Array<{ kind: string }>
  },
  segIndex: number,
): boolean {
  if (!message.streaming) return false
  const segs = message.segments
  if (!segs?.length) {
    return Boolean(message.reasoningContent) && !String(message.content || '').trim()
  }
  return segs[segIndex]?.kind === 'reasoning' && segIndex === segs.length - 1
}
