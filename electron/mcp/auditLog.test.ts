import { beforeEach, expect, it, vi } from 'vitest'
import { createMcpAuditLog } from './auditLog'

const append = vi.hoisted(() => vi.fn())
vi.mock('../store/appDatabase', () => ({ getAppDatabase: () => ({ appendMcpAudit: append }) }))
beforeEach(() => { append.mockReset() })

it('adds the timestamp for protocol events and retains explicit event timestamps', () => {
  const log = createMcpAuditLog()
  const now = vi.spyOn(Date, 'now').mockReturnValue(1234)
  try {
    log({ method: 'tools/list', ok: true })
    expect(append).toHaveBeenLastCalledWith({ method: 'tools/list', ok: true, ts: 1234 }, 1234)
    log({ method: 'tools/call', ok: false, ts: 500 })
    expect(append).toHaveBeenLastCalledWith({ method: 'tools/call', ok: false, ts: 500 }, 500)
  } finally { now.mockRestore() }
})
