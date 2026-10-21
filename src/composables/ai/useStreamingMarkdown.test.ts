import { afterEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useStreamingMarkdown, MARKDOWN_STREAM_INTERVAL_MS } from './useStreamingMarkdown'

const scopes: ReturnType<typeof effectScope>[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()); vi.useRealTimers() })
function setup() {
  vi.useFakeTimers()
  const content = ref('# Initial')
  const streaming = ref(true)
  const scope = effectScope()
  scopes.push(scope)
  const blocks = scope.run(() => useStreamingMarkdown(() => content.value, () => streaming.value))!
  return { content, streaming, scope, blocks }
}

it('renders periodically during uninterrupted output and includes the latest delta', async () => {
  const f = setup()
  expect(f.blocks.value[0].content).toBe('<h1>Initial</h1>')
  for (let i = 0; i < 3; i++) {
    f.content.value += ' more'
    await nextTick()
    await vi.advanceTimersByTimeAsync(40)
  }
  expect(f.blocks.value[0].content).toBe('<h1>Initial more more more</h1>')
  f.content.value += ' tail'
  await nextTick()
  await vi.advanceTimersByTimeAsync(MARKDOWN_STREAM_INTERVAL_MS)
  expect(f.blocks.value[0].content).toContain('tail')
})

it.each(['question boundary', 'finished', 'stopped'])('flushes immediately when the segment is sealed: %s', async () => {
  const f = setup()
  f.content.value = '**Latest content**'
  await nextTick()
  expect(f.blocks.value[0].content).not.toContain('Latest')
  f.streaming.value = false
  await nextTick()
  expect(f.blocks.value[0].content).toBe('<p><strong>Latest content</strong></p>')
  expect(vi.getTimerCount()).toBe(0)
})

it('cancels deferred rendering on disposal', async () => {
  const f = setup()
  f.content.value += ' pending'
  await nextTick()
  const previous = f.blocks.value
  expect(vi.getTimerCount()).toBe(1)
  f.scope.stop()
  await vi.advanceTimersByTimeAsync(MARKDOWN_STREAM_INTERVAL_MS)
  expect(f.blocks.value).toBe(previous)
  expect(vi.getTimerCount()).toBe(0)
})
