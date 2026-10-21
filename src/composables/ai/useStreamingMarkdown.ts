import { onScopeDispose, shallowRef, watch } from 'vue'
import { useMarkdownRenderer, type MarkdownBlock } from './useMarkdownRenderer'

export const MARKDOWN_STREAM_INTERVAL_MS = 120

/** Leading/trailing throttle: continuous output never postpones rendering forever. */
export function useStreamingMarkdown(content: () => string, streaming: () => boolean) {
  const render = useMarkdownRenderer().createStreamRenderer()
  const blocks = shallowRef<MarkdownBlock[]>([])
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastRenderAt = -Infinity
  const flush = () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    blocks.value = render(content())
    lastRenderAt = Date.now()
  }
  watch([content, streaming], ([, live]) => {
    const remaining = MARKDOWN_STREAM_INTERVAL_MS - (Date.now() - lastRenderAt)
    if (!live || remaining <= 0) flush()
    else if (timer === undefined) timer = setTimeout(flush, remaining)
  }, { immediate: true })
  onScopeDispose(() => { if (timer !== undefined) clearTimeout(timer) })
  return blocks
}
