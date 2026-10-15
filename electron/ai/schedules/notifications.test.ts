import { afterEach, expect, it, vi } from 'vitest'
import { AiScheduleNotifier, type StoredAiNotification } from './notifications'
import { validateAiNotification } from '../../../shared/aiNotifications'
import type { AiSchedule, AiScheduleRun } from '../../../shared/aiSchedules'

afterEach(() => vi.useRealTimers())
const plan = { id: 'p', name: 'inspect' } as AiSchedule
const run: AiScheduleRun = { id: 'r', scheduleId: 'p', name: 'inspect', connectionId: 'host', startedAt: 1, finishedAt: 2, status: 'completed', health: 'healthy', content: 'report' }
function setup() {
  let stored: StoredAiNotification | undefined
  const post = vi.fn<typeof fetch>(async () => new Response('ok'))
  const notifier = new AiScheduleNotifier({ read: () => stored, save: value => { stored = value }, seal: value => value ? `sealed:${value}` : '', unseal: value => value.replace(/^sealed:/,''), post, timeoutMs: 100 })
  const configure = () => notifier.save({ enabled: true, mode: 'issues', url: 'https://example.test/hook?secret=value', token: 'private-token' })
  return { notifier, post, configure, stored: () => stored }
}
it('encrypts endpoint and token, redacts the token on read and drops it on endpoint change', () => {
  const { notifier, configure, stored } = setup()
  configure()
  expect(stored()?.sealedUrl).toMatch(/^sealed:/)
  expect(stored()?.sealedToken).toBe('sealed:private-token')
  expect(notifier.settings()).toMatchObject({ hasToken: true })
  expect(notifier.settings()).not.toHaveProperty('token')
  notifier.save({ enabled: true, mode: 'issues', url: 'https://other.test/hook' })
  expect(notifier.settings().hasToken).toBe(false)
})
it('defaults to disabled and skips healthy or user-cancelled runs', async () => {
  const { notifier, configure, post } = setup()
  const signal = new AbortController().signal
  expect((await notifier.notify(plan, run, signal)).status).toBe('skipped')
  configure()
  expect((await notifier.notify(plan, run, signal)).status).toBe('skipped')
  expect((await notifier.notify(plan, { ...run, status: 'cancelled', health: 'critical' }, signal)).status).toBe('skipped')
  expect(post).not.toHaveBeenCalled()
})
it.each(['warning','critical','unknown'] as const)('sends %s reports as bounded JSON without tool output or endpoint secrets', async health => {
  const { notifier, configure, post } = setup()
  configure()
  expect((await notifier.notify(plan, { ...run, health }, new AbortController().signal)).status).toBe('sent')
  const args = post.mock.calls[0][1]!
  expect(args.redirect).toBe('error')
  expect(args.headers).toMatchObject({ Authorization: 'Bearer private-token' })
  const body = JSON.parse(args.body as string)
  expect(body.result.health).toBe(health)
  expect(args.body).not.toContain('private-token')
  expect(args.body).not.toContain('secret=value')
})
it('records HTTP or network failures without persisting secrets from exception messages', async () => {
  const { notifier, configure, post } = setup()
  configure()
  post.mockResolvedValueOnce(new Response('', { status: 503 }))
  expect(await notifier.test()).toMatchObject({ status: 'failed', error: expect.stringContaining('503') })
  post.mockRejectedValueOnce(new Error('https://example.test/hook?secret=value private-token'))
  const failure = await notifier.test()
  expect(failure.status).toBe('failed')
  expect(failure.error).not.toContain('private-token')
  expect(failure.error).not.toContain('secret=value')
})
it('bounds notification delivery and cancels an in-flight request', async () => {
  vi.useFakeTimers()
  const { notifier, configure, post } = setup()
  configure()
  post.mockImplementationOnce(async (_url, options) => new Promise((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new Error('abort')), { once: true })))
  const delivery = notifier.test()
  await vi.advanceTimersByTimeAsync(100)
  expect(await delivery).toMatchObject({ status: 'failed', error: expect.stringContaining('超时') })
})
it.each(['file:///private','javascript:alert(1)','https://user:password@example.test/hook','https://example.test/hook#fragment'])('rejects unsupported endpoint %s', url => {
  expect(() => validateAiNotification({ enabled: true, url, mode: 'issues' })).toThrow()
})
