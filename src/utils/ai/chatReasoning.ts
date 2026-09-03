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
