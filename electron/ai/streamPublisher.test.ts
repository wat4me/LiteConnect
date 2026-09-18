import { afterEach, expect, it, vi } from 'vitest'
import { createStreamPublisher } from './streamPublisher'

afterEach(() => vi.useRealTimers())
it('batches tokens and preserves reasoning/content/tool order', async () => {
  vi.useFakeTimers()
  const send = vi.fn()
  const publisher = createStreamPublisher(send)
  for (let i = 0; i < 100; i++) publisher.publish({ type: 'reasoning', value: 'x' })
  expect(send).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(50)
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenLastCalledWith({ type: 'reasoning', value: 'x'.repeat(100) })
  publisher.publish({ type: 'content', value: 'before' })
  publisher.publish({ type: 'tool', value: { id: 't', name: 'grep', phase: 'running' } })
  publisher.publish({ type: 'content', value: 'after' })
  publisher.flush()
  expect(send.mock.calls.map(c => c[0].type)).toEqual(['reasoning', 'content', 'tool', 'content'])
  await vi.advanceTimersByTimeAsync(50)
  expect(send).toHaveBeenCalledTimes(4)
})

it('bounds pending text and tolerates a missing renderer', () => {
  vi.useFakeTimers()
  const send = vi.fn(() => { throw new Error('destroyed') })
  const publisher = createStreamPublisher(send)
  expect(() => publisher.publish({ type: 'content', value: 'x'.repeat(20_000) })).not.toThrow()
  expect(send).toHaveBeenCalledTimes(1)
  publisher.flush()
  expect(vi.getTimerCount()).toBe(0)
})
