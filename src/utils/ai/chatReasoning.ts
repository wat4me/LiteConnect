/** Visible tail of a live reasoning stream — one line, newest text wins. */
export const REASONING_LIVE_SNIPPET_MAX = 40

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
