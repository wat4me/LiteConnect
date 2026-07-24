import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('element-plus/es/components/message/index', () => ({
  ElMessage: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}))

import { ElMessage } from 'element-plus/es/components/message/index'
import { useDbConnections } from './useDbConnections'

const connection = {
  id: 'db-1', name: 'Primary', engine: 'mysql', host: 'db.example.com', port: 3306,
  username: 'root', password: '', database: 'app', createdAt: 0, updatedAt: 0,
} as const

function session(connectionId: string) {
  return {
    sessionId: `session-${connectionId}`,
    connectionId,
    connectionName: connectionId,
    engine: 'mysql' as const,
    host: 'db.example.com', port: 3306, username: 'root', database: 'app', serverVersion: '8.0',
  }
}

describe('useDbConnections connect lifecycle', () => {
  const originalWindow = globalThis.window
  let dbConnect: ReturnType<typeof vi.fn>
  let dbDisconnect: ReturnType<typeof vi.fn>
  let dbDisconnectByConnectionId: ReturnType<typeof vi.fn>
  let onConnectNew: ReturnType<typeof vi.fn>
  let onConnectFailed: ReturnType<typeof vi.fn>
  let consoleWarn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    dbConnect = vi.fn()
    dbDisconnect = vi.fn(async () => {})
    dbDisconnectByConnectionId = vi.fn(async () => {})
    onConnectNew = vi.fn()
    onConnectFailed = vi.fn()
    consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    globalThis.window = {
      LiteConnect: { dbConnect, dbDisconnect, dbDisconnectByConnectionId },
    } as unknown as Window & typeof globalThis
  })

  afterEach(() => {
    consoleWarn.mockRestore()
    globalThis.window = originalWindow
  })

  function api() {
    return useDbConnections({
      onConnectExisting: vi.fn(), onConnectNew, onConnectFailed,
      cleanupAfterDisconnect: vi.fn(), onActiveFallback: vi.fn(), afterDisconnect: vi.fn(),
    })
  }

  it('deduplicates a rapid double-click into one IPC connect', async () => {
    let resolve!: (value: ReturnType<typeof session>) => void
    dbConnect.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const state = api()
    const first = state.connect(connection)
    const second = state.connect(connection)
    resolve(session(connection.id))
    await Promise.all([first, second])

    expect(dbConnect).toHaveBeenCalledTimes(1)
    expect(state.isConnActive(connection.id)).toBe(true)
    expect(onConnectNew).toHaveBeenCalledOnce()
  })

  it('disconnects a late connect response and clears connecting state', async () => {
    let resolve!: (value: ReturnType<typeof session>) => void
    dbConnect.mockReturnValueOnce(new Promise((r) => { resolve = r }))
    const state = api()
    const pending = state.connect(connection)
    await state.disconnectConnection(connection.id)
    resolve(session(connection.id))
    await pending

    expect(dbDisconnectByConnectionId).toHaveBeenCalledWith(connection.id)
    expect(dbDisconnect).toHaveBeenCalledWith('session-db-1')
    expect(state.isConnActive(connection.id)).toBe(false)
    expect(state.isConnecting(connection.id)).toBe(false)
  })

  it('allows different connection IDs to connect concurrently', async () => {
    const second = { ...connection, id: 'db-2', name: 'Reporting' }
    dbConnect.mockImplementation(async (id: string) => session(id))
    const state = api()
    await Promise.all([state.connect(connection), state.connect(second)])

    expect(dbConnect.mock.calls.map(([id]) => id).sort()).toEqual(['db-1', 'db-2'])
    expect(state.liveSessionCount.value).toBe(2)
  })

  it('restores UI state after a failed connect', async () => {
    dbConnect.mockRejectedValueOnce(new Error('access denied'))
    const state = api()
    await state.connect(connection)

    expect(state.isConnecting(connection.id)).toBe(false)
    expect(state.isConnActive(connection.id)).toBe(false)
    expect(onConnectFailed).toHaveBeenCalledWith(connection)
    expect(ElMessage.error).toHaveBeenCalled()
  })
})
