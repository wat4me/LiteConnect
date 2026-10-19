import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { Connection } from '@/env.d'
import type { TerminalPwdTracker } from '@/domain/terminal/types'
import type { HostKeyMismatchData } from '@/domain/app/security'
import { SSH_HOST_KEY_CONFIRMATION_REQUIRED } from '@shared/sshHostKeyConfirmation'
import { SSH_CONNECTION_CANCELLED } from '@shared/sshConnectionProgress'

vi.mock('vue', async (original) => ({ ...await original<typeof import('vue')>(), onMounted: (fn: () => void) => fn(), onBeforeUnmount: vi.fn() }))
vi.mock('../../i18n', () => ({ t: (key: string) => key }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { error: vi.fn() } }))
import { ElMessage } from 'element-plus/es/components/message/index'
import { useSessionManager } from './useSessionManager'
import { useSecurityDialogs } from '../app/useSecurityDialogs'

const connection = { id: 'c1', name: 'Server', host: 'server.test' } as Connection
const prompt: HostKeyMismatchData = { connectionId: 'c1', host: 'server.test', port: 22, existingFingerprint: '', newFingerprint: 'SHA256:new', role: 'target' }

function setup() {
  let onHostKey!: (data: HostKeyMismatchData) => void
  let onKeyboard!: (data: any) => void
  let onKeyboardClosed!: (id: string) => void
  const progress: Array<(data: any) => void> = []
  const api = {
    sshConnect: vi.fn().mockRejectedValue(new Error(`Error invoking remote method 'ssh:connect': Error: ${SSH_HOST_KEY_CONFIRMATION_REQUIRED}`)),
    sshConfirmHostKey: vi.fn().mockResolvedValue('session-1'),
    sshRejectHostKey: vi.fn().mockResolvedValue(undefined),
    onSshHostKeyMismatch: vi.fn((fn) => { onHostKey = fn; return vi.fn() }),
    onSshDecryptionFailed: vi.fn(() => vi.fn()),
    onSshKeyboardInteractive: vi.fn((fn) => { onKeyboard = fn; return vi.fn() }),
    onSshKeyboardInteractiveClosed: vi.fn((fn) => { onKeyboardClosed = fn; return vi.fn() }),
    onSshConnectionProgress: vi.fn((fn) => { progress.push(fn); return vi.fn() }),
    sshReplyKeyboardInteractive: vi.fn().mockResolvedValue(true),
    sftpExecHome: vi.fn().mockResolvedValue('/root'),
    recordRecentConnection: vi.fn().mockResolvedValue(undefined),
    getRecentConnections: vi.fn().mockResolvedValue([connection]),
  }
  vi.stubGlobal('window', { LiteConnect: api, addEventListener: vi.fn() })
  const sessions = useSessionManager({ pwdTracker: { initSession: vi.fn() } as unknown as TerminalPwdTracker })
  sessions.hydrateConnectionData({ connections: [connection], recentConnections: [] })
  sessions.connectSidebar({ sidebarVisible: ref(false), aiSidebarVisible: ref(false), sidebarGroupId: ref(null), sidebarSessionId: ref(null), fileSidebarRef: ref(null), setSidebarTarget: vi.fn(), syncSidebarState: vi.fn() })
  const dialogs = useSecurityDialogs({ connections: sessions.connections, onSelectHome: sessions.onSelectHome, editConnection: vi.fn(), adoptSession: sessions.adoptSession, hasOpenSession: sessions.hasOpenSession })
  return { api, sessions, dialogs, showPrompt: (data = prompt) => onHostKey(data),
    showKeyboard: (id: string, connectionId: string) => onKeyboard({ requestId: id, connectionId, sessionId: id, name: '', instructions: '', prompts: [], role: 'target' }),
    closeKeyboard: (id: string) => onKeyboardClosed(id),
    reportProgress: (connectionId: string, stage: string) => progress.forEach((fn) => fn({ connectionId, stage })) }
}

describe('first SSH connection host-key confirmation', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('queues host and keyboard prompts without overwriting the active server', () => {
    const s = setup()
    s.showPrompt()
    s.showPrompt({ ...prompt, connectionId: 'c2', host: 'other.test' })
    s.showKeyboard('otp3', 'c3')
    expect(s.dialogs.hostKeyMismatchData.value?.connectionId).toBe('c1')
    expect(s.dialogs.keyboardPrompt.value).toBeNull()
    s.dialogs.handleHostKeyReject()
    expect(s.dialogs.hostKeyMismatchData.value?.connectionId).toBe('c2')
    s.dialogs.handleHostKeyReject()
    expect(s.dialogs.keyboardPrompt.value?.requestId).toBe('otp3')
    s.closeKeyboard('otp3')
    expect(s.dialogs.keyboardPrompt.value).toBeNull()
  })

  it('removes failed or cancelled requests and keeps the next server visible', () => {
    const s = setup()
    s.showKeyboard('otp1', 'c1')
    s.showPrompt({ ...prompt, connectionId: 'c2' })
    s.reportProgress('c1', 'cancelled')
    expect(s.dialogs.keyboardPrompt.value).toBeNull()
    expect(s.dialogs.hostKeyMismatchData.value?.connectionId).toBe('c2')
    s.reportProgress('c2', 'failed')
    expect(s.dialogs.hostKeyMismatchVisible.value).toBe(false)
  })

  it('shows trust confirmation without a failure toast and adopts the confirmed session', async () => {
    const { sessions, dialogs, showPrompt } = setup()
    showPrompt()
    await sessions.onConnect('c1')
    expect(dialogs.hostKeyMismatchVisible.value).toBe(true)
    expect(ElMessage.error).not.toHaveBeenCalled()
    expect(sessions.groups.value).toHaveLength(0)
    expect(sessions.connectingConnectionIds.value.size).toBe(0)
    await dialogs.handleHostKeyAccept()
    expect(sessions.activeSessionId.value).toBe('session-1')
    expect(sessions.groups.value[0].sessions).toHaveLength(1)
  })

  it('cancels without creating a tab or retrying', async () => {
    const { api, sessions, dialogs, showPrompt } = setup()
    showPrompt()
    await sessions.onConnect('c1')
    dialogs.handleHostKeyReject()
    expect(api.sshRejectHostKey).toHaveBeenCalledWith('c1')
    expect(api.sshConfirmHostKey).not.toHaveBeenCalled()
    expect(sessions.groups.value).toHaveLength(0)
    expect(ElMessage.error).not.toHaveBeenCalled()
  })

  it('continues from jump-host trust to target-host trust without a false failure', async () => {
    const { api, sessions, dialogs, showPrompt } = setup()
    showPrompt({ ...prompt, host: 'jump.test', role: 'jump' })
    api.sshConfirmHostKey.mockImplementationOnce(async () => {
      showPrompt()
      throw new Error(SSH_HOST_KEY_CONFIRMATION_REQUIRED)
    })
    await dialogs.handleHostKeyAccept()
    expect(dialogs.hostKeyMismatchVisible.value).toBe(true)
    expect(dialogs.hostKeyMismatchData.value?.host).toBe('server.test')
    expect(ElMessage.error).not.toHaveBeenCalled()
    await dialogs.handleHostKeyAccept()
    expect(sessions.activeSessionId.value).toBe('session-1')
  })

  it('still reports real connection failures, including after trust', async () => {
    const { api, sessions, dialogs, showPrompt } = setup()
    api.sshConnect.mockRejectedValueOnce(new Error('Authentication failed'))
    await sessions.onConnect('c1')
    expect(ElMessage.error).toHaveBeenCalledTimes(1)
    showPrompt()
    api.sshConfirmHostKey.mockRejectedValueOnce(new Error('Connection refused'))
    await dialogs.handleHostKeyAccept()
    expect(ElMessage.error).toHaveBeenCalledTimes(2)
    expect(sessions.groups.value).toHaveLength(0)
  })

  it('retains an offline failure after progress ends and clears it on retry', async () => {
    const s = setup()
    s.api.sshConnect.mockImplementationOnce(async () => {
      s.reportProgress('c1', 'connecting')
      s.reportProgress('c1', 'failed')
      throw new Error('Connection error: Timed out while waiting for handshake')
    })
    await s.sessions.onConnect('c1')
    expect(s.sessions.connectionErrors.value.c1).toBe('terminal.connectTimeoutHint')
    expect(s.sessions.connectingConnectionIds.value.size).toBe(0)
    expect(s.sessions.groups.value).toHaveLength(0)
    expect(ElMessage.error).toHaveBeenCalledWith(expect.objectContaining({ duration: 0, showClose: true }))
    s.api.sshConnect.mockImplementationOnce(async () => {
      expect(s.sessions.connectionErrors.value.c1).toBeUndefined()
      throw new Error(SSH_CONNECTION_CANCELLED)
    })
    await s.sessions.onConnect('c1')
    expect(s.sessions.connectionErrors.value).toEqual({})
    expect(ElMessage.error).toHaveBeenCalledTimes(1)
  })
})
