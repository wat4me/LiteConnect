import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import type { Connection } from '@/env.d'
import type { TerminalPwdTracker } from '@/domain/terminal/types'
import type { HostKeyMismatchData } from '@/domain/app/security'
import { SSH_HOST_KEY_CONFIRMATION_REQUIRED } from '@shared/sshHostKeyConfirmation'

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
  const api = {
    sshConnect: vi.fn().mockRejectedValue(new Error(`Error invoking remote method 'ssh:connect': Error: ${SSH_HOST_KEY_CONFIRMATION_REQUIRED}`)),
    sshConfirmHostKey: vi.fn().mockResolvedValue('session-1'),
    sshRejectHostKey: vi.fn().mockResolvedValue(undefined),
    onSshHostKeyMismatch: vi.fn((fn) => { onHostKey = fn; return vi.fn() }),
    onSshDecryptionFailed: vi.fn(() => vi.fn()),
    onSshKeyboardInteractive: vi.fn(() => vi.fn()),
    sftpExecHome: vi.fn().mockResolvedValue('/root'),
    recordRecentConnection: vi.fn().mockResolvedValue(undefined),
    getRecentConnections: vi.fn().mockResolvedValue([connection]),
  }
  vi.stubGlobal('window', { LiteConnect: api, addEventListener: vi.fn() })
  const sessions = useSessionManager({ pwdTracker: { initSession: vi.fn() } as unknown as TerminalPwdTracker })
  sessions.hydrateConnectionData({ connections: [connection], recentConnections: [] })
  sessions.connectSidebar({ sidebarVisible: ref(false), aiSidebarVisible: ref(false), sidebarGroupId: ref(null), sidebarSessionId: ref(null), fileSidebarRef: ref(null), setSidebarTarget: vi.fn(), syncSidebarState: vi.fn() })
  const dialogs = useSecurityDialogs({ connections: sessions.connections, onSelectHome: sessions.onSelectHome, editConnection: vi.fn(), adoptSession: sessions.adoptSession, hasOpenSession: sessions.hasOpenSession })
  return { api, sessions, dialogs, showPrompt: (data = prompt) => onHostKey(data) }
}

describe('first SSH connection host-key confirmation', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

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
})
