import { EventEmitter } from 'events'
import type { Client } from 'ssh2'
import { afterEach, expect, it, vi } from 'vitest'
import { attachKeyboardInteractive } from './connectionAuth'
import { SSH_AUTH_PROMPT_TIMEOUT_MS } from '../../shared/sshConnectionProgress'
afterEach(() => vi.useRealTimers())

function setup() {
  vi.useFakeTimers()
  const client = Object.assign(new EventEmitter(), { destroy: vi.fn() })
  const errors = vi.fn()
  client.on('error', errors)
  let answer!: (answers: string[] | null) => void
  const controller = new AbortController()
  const clock = attachKeyboardInteractive(client as unknown as Client, 'target', '', 's1', {
    signal: controller.signal, onData: vi.fn(), onError: vi.fn(), onClose: vi.fn(),
    onKeyboardInteractive: () => new Promise((resolve) => { answer = resolve }),
  })
  clock.start()
  const finish = vi.fn()
  const prompt = () => client.emit('keyboard-interactive', 'OTP', '', '', [{ prompt: 'OTP code', echo: false }], finish)
  return { client, errors, finish, prompt, controller, answer: (value: string[] | null) => answer(value) }
}

it('lets the user answer after the original handshake deadline', async () => {
  const s = setup()
  vi.advanceTimersByTime(19000)
  s.prompt()
  vi.advanceTimersByTime(30000)
  expect(s.errors).not.toHaveBeenCalled()
  s.answer(['123456'])
  await Promise.resolve()
  expect(s.finish).toHaveBeenCalledWith(['123456'])
  s.client.emit('ready')
  vi.advanceTimersByTime(SSH_AUTH_PROMPT_TIMEOUT_MS)
  expect(s.errors).not.toHaveBeenCalled()
})

it('still times out a stalled network handshake', () => {
  const s = setup()
  vi.advanceTimersByTime(20000)
  expect(s.errors.mock.calls[0][0].message).toContain('handshake')
  expect(s.client.destroy).toHaveBeenCalledOnce()
})

it('expires an unanswered prompt and ignores a late reply', async () => {
  const s = setup()
  s.prompt()
  vi.advanceTimersByTime(SSH_AUTH_PROMPT_TIMEOUT_MS)
  s.answer(['late'])
  await Promise.resolve()
  expect(s.errors.mock.calls[0][0].message).toContain('Authentication prompt timed out')
  expect(s.finish).not.toHaveBeenCalled()
})

it('clears the authentication timer on cancellation', async () => {
  const s = setup()
  s.prompt()
  s.controller.abort()
  s.answer(['late'])
  await Promise.resolve()
  vi.advanceTimersByTime(SSH_AUTH_PROMPT_TIMEOUT_MS)
  expect(s.errors).not.toHaveBeenCalled()
  expect(s.finish).not.toHaveBeenCalled()
})
