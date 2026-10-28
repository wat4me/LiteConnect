import { randomBytes } from 'node:crypto'
import { beforeEach, expect, it, vi } from 'vitest'
import { resolveConnectionX11 } from './connectionX11'
import type { Connection } from './types'
import { SSH_CONNECTION_CANCELLED } from '../../shared/sshConnectionProgress'

const mocks = vi.hoisted(() => ({ ensure: vi.fn() }))
vi.mock('./x11/automaticX11', () => ({ ensureAutomaticLocalX11: mocks.ensure }))
vi.mock('../../shared/x11Policy', () => ({ resolveX11Mode: (profile: Connection) => profile.x11Mode === 'off' ? 'off' : 'auto' }))

const connection = { id: 'test', x11Forwarding: false } as Connection
beforeEach(() => { vi.clearAllMocks() })

it('does not start a display for disabled or already-cancelled connections', async () => {
  expect(await resolveConnectionX11({ ...connection, x11Mode: 'off' })).toEqual({ useX11: false })
  const controller = new AbortController()
  controller.abort()
  await expect(resolveConnectionX11(connection, controller.signal)).rejects.toThrow(SSH_CONNECTION_CANCELLED)
  expect(mocks.ensure).not.toHaveBeenCalled()
})

it('cancels promptly while allowing a shared display startup to finish', async () => {
  let finish!: (target: object) => void
  mocks.ensure.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  const controller = new AbortController()
  const waiting = resolveConnectionX11(connection, controller.signal)
  await vi.waitFor(() => expect(mocks.ensure).toHaveBeenCalledOnce())
  controller.abort()
  await expect(waiting).rejects.toThrow(SSH_CONNECTION_CANCELLED)
  finish({ endpoint: { host: '127.0.0.1', port: 6051 }, display: 51, localCookie: randomBytes(16) })
})

it('issues independent session cookies and leaves the saved connection unchanged', async () => {
  const localCookie = randomBytes(16)
  mocks.ensure.mockResolvedValue({ endpoint: { host: '127.0.0.1', port: 6051 }, display: 51, localCookie })
  const first = await resolveConnectionX11(connection)
  const second = await resolveConnectionX11(connection)
  expect(first.useX11).toBe(true)
  expect(first.prepared?.connection).toMatchObject({ x11Host: '127.0.0.1', x11Display: 51, x11Forwarding: true })
  expect(first.prepared?.auth.localCookie).toBe(localCookie)
  expect(first.prepared?.auth.remoteCookie).not.toEqual(localCookie)
  expect(first.prepared?.auth.remoteCookie).not.toEqual(second.prepared?.auth.remoteCookie)
  expect(connection.x11Forwarding).toBe(false)
  expect(connection.x11Display).toBeUndefined()
})

it('keeps the ordinary shell available when the local display fails', async () => {
  mocks.ensure.mockRejectedValue(new Error('display unavailable'))
  const result = await resolveConnectionX11(connection)
  expect(result.useX11).toBe(false)
  expect(result.x11Notice).toContain('display unavailable')
})
