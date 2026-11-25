import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HostKeyMismatchData } from '@/domain/app/security'
import type { AiTerminalConversation } from '@/domain/ai/chat'
import type { ConnectionGroup } from '@/domain/session/types'
import { useAiTerminalLink } from './useAiTerminalLink'

const conversation = { connectionId: 'host', sessionId: 'ai-host', threadId: 'thread-one' }
const draft = { connectionId: 'host', draftId: 1 }
const hostKey: HostKeyMismatchData = { connectionId: 'host', host: 'host.test', port: 22, existingFingerprint: '', newFingerprint: 'SHA256:fixture' }
const scopes: EffectScope[] = []
afterEach(() => { scopes.splice(0).forEach(scope => scope.stop()) })

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function setup(initial: AiTerminalConversation = conversation) {
  const current = ref<AiTerminalConversation>({ ...initial })
  const isHomeActive = ref(true)
  const isStandaloneAiActive = ref(true)
  const aiSidebarVisible = ref(false)
  const activeSessionId = ref<string | null>(null)
  const group = ref<ConnectionGroup | null>(null)
  const waitingForHostKey = ref(false)
  const disconnectedSessionIds = ref(new Set<string>())
  const connection = deferred<string | null>()
  const connectTerminal = vi.fn(() => connection.promise)
  const adoptTerminalInBackground = vi.fn(async () => {})
  const selectTerminal = vi.fn((id: string) => {
    group.value ??= { connectionId: initial.connectionId, connectionName: 'Host', activeSessionId: id, nextTabNumber: 2,
      sessions: [{ id, connectionId: initial.connectionId, connectionName: 'Host', tabNumber: 1 }] }
    activeSessionId.value = id
    isHomeActive.value = false
    isStandaloneAiActive.value = false
  })
  const sendSelection = vi.fn(() => true)
  const scope = effectScope()
  scopes.push(scope)
  const link = scope.run(() => useAiTerminalLink({
    activeConversation: () => current.value,
    isSshMode: ref(true), isStandaloneAiActive, isDockerMode: ref(false), activeSessionId, aiSidebarVisible,
    disconnectedSessionIds, getGroup: () => group.value,
    awaitingHostKey: () => waitingForHostKey.value, connectTerminal, adoptTerminalInBackground,
    selectTerminal, selectStandaloneAi: () => {
      isHomeActive.value = true
      isStandaloneAiActive.value = true
    }, sendSelection,
  }))!
  return { link, current, isHomeActive, isStandaloneAiActive, activeSessionId, aiSidebarVisible, group, waitingForHostKey, connection, disconnectedSessionIds,
    connectTerminal, adoptTerminalInBackground, selectTerminal, sendSelection }
}

describe('AI / terminal workspace link', () => {
  it('leaves the newly selected thread in place when a connection finishes late for the same AI session', async () => {
    const app = setup()
    const opening = app.link.showAiTerminal(conversation)
    app.current.value.threadId = 'thread-two'
    app.connection.resolve('terminal')
    await opening
    expect(app.selectTerminal).not.toHaveBeenCalled()
    expect(app.link.openingAiTerminal.value).toBe(false)
    expect(app.aiSidebarVisible.value).toBe(false)
  })

  it('keeps a draft beside its terminal and follows the chat created on first send', async () => {
    const app = setup(draft)
    const opening = app.link.showAiTerminal(draft)
    app.connection.resolve('terminal')
    await opening
    expect(app.link.hasLinkedAiView.value).toBe(true)
    expect(app.link.linkedAiSessionId.value).toBeUndefined()
    expect(app.link.workspaceAiSessionId.value).toBeNull()
    expect(app.link.deliverSelectionToLinkedAi('output', 'insert')).toBe(true)
    expect(app.sendSelection).toHaveBeenLastCalledWith(draft, 'output', 'insert')
    app.current.value = { ...conversation, draftId: draft.draftId }
    expect(app.link.linkedAiSessionId.value).toBe('ai-host')
    app.current.value = { ...conversation, threadId: 'thread-two' }
    expect(app.link.hasLinkedAiView.value).toBe(true)
    app.link.showLinkedAiOnly()
    expect(app.isHomeActive.value).toBe(true)
    expect(app.aiSidebarVisible.value).toBe(false)
    expect(app.link.hasDockedAi.value).toBe(false)
  })

  it('docks the new chat if the first send finishes before the terminal', async () => {
    const app = setup(draft)
    const opening = app.link.showAiTerminal(draft)
    app.current.value = { ...conversation, draftId: draft.draftId }
    app.connection.resolve('terminal')
    await opening
    expect(app.link.linkedAiSessionId.value).toBe('ai-host')
    expect(app.selectTerminal).toHaveBeenCalledExactlyOnceWith('terminal')
  })

  it('does not navigate to a terminal requested by an abandoned draft on the same host', async () => {
    const app = setup(draft)
    const opening = app.link.showAiTerminal(draft)
    app.current.value = { ...draft, draftId: 2 }
    app.connection.resolve('terminal')
    await opening
    expect(app.selectTerminal).not.toHaveBeenCalled()
    expect(app.link.hasLinkedAiView.value).toBe(false)
  })

  it('invalidates the request if the user leaves and returns before SSH is ready', async () => {
    const app = setup()
    const opening = app.link.showAiTerminal(conversation)
    app.isStandaloneAiActive.value = false
    app.isStandaloneAiActive.value = true
    app.connection.resolve('terminal')
    await opening
    expect(app.selectTerminal).not.toHaveBeenCalled()
  })

  it('keeps the attached chat on its terminal across tab changes and releases it when the terminal closes', async () => {
    const app = setup()
    const opening = app.link.showAiTerminal(conversation)
    app.connection.resolve('terminal')
    await opening
    app.activeSessionId.value = 'other-terminal'
    expect(app.link.hasDockedAi.value).toBe(true)
    expect(app.link.hasLinkedAiView.value).toBe(false)
    expect(app.link.revealLinkedAiApproval('ai-host')).toBe(true)
    expect(app.activeSessionId.value).toBe('terminal')
    app.group.value = null
    expect(app.link.hasDockedAi.value).toBe(false)
    expect(app.link.hasLinkedAiView.value).toBe(false)
  })

  it('adopts the trusted terminal in the background when the conversation changed during confirmation', async () => {
    const app = setup()
    const opening = app.link.showAiTerminal(conversation)
    app.waitingForHostKey.value = true
    app.connection.resolve(null)
    await opening
    expect(app.link.openingAiTerminal.value).toBe(true)

    const accepted = deferred<string>()
    const confirming = app.link.confirmHostKey(hostKey, async adopt => {
      const id = await accepted.promise
      await adopt?.(conversation.connectionId, id)
    })
    app.current.value.threadId = 'thread-two'
    app.waitingForHostKey.value = false
    await nextTick()
    accepted.resolve('trusted-terminal')
    await confirming
    expect(app.adoptTerminalInBackground).toHaveBeenCalledWith('host', 'trusted-terminal')
    expect(app.selectTerminal).not.toHaveBeenCalled()
    expect(app.link.openingAiTerminal.value).toBe(false)
  })

  it('handles host-key acceptance before the initial connection response is delivered', async () => {
    const app = setup()
    const opening = app.link.showAiTerminal(conversation)
    app.waitingForHostKey.value = true
    await app.link.confirmHostKey(hostKey, async adopt => {
      app.waitingForHostKey.value = false
      await adopt?.('host', 'trusted-terminal')
    })
    app.connection.resolve(null)
    await opening
    expect(app.selectTerminal).toHaveBeenCalledExactlyOnceWith('trusted-terminal')
    expect(app.link.linkedAiSessionId.value).toBe('ai-host')
  })

  it('keeps unrelated host-key prompts independent and clears a cancelled terminal request', async () => {
    const app = setup()
    const opening = app.link.showAiTerminal(conversation)
    app.waitingForHostKey.value = true
    app.connection.resolve(null)
    await opening
    const confirm = vi.fn(async () => {})
    await app.link.confirmHostKey({ ...hostKey, purpose: 'ai' }, confirm)
    expect(confirm).toHaveBeenCalledWith()
    app.link.rejectHostKey({ ...hostKey, connectionId: 'other' })
    expect(app.link.openingAiTerminal.value).toBe(true)
    app.waitingForHostKey.value = false
    await nextTick()
    expect(app.link.openingAiTerminal.value).toBe(false)
  })

  it('reuses a terminal and routes selection and approvals to its linked AI session', async () => {
    const app = setup()
    app.group.value = { connectionId: 'host', connectionName: 'Host', activeSessionId: 'terminal', nextTabNumber: 2,
      sessions: [{ id: 'terminal', connectionId: 'host', connectionName: 'Host', tabNumber: 1 }] }
    await app.link.showAiTerminal(conversation)
    expect(app.connectTerminal).not.toHaveBeenCalled()
    expect(app.link.workspaceAiSessionId.value).toBe('ai-host')
    expect(app.link.linkedTerminalSessionId.value).toBe('terminal')
    app.disconnectedSessionIds.value.add('terminal')
    expect(app.link.linkedTerminalSessionId.value).toBeUndefined()
    app.disconnectedSessionIds.value.delete('terminal')
    app.aiSidebarVisible.value = false
    app.current.value.threadId = 'thread-two'
    expect(app.link.deliverSelectionToLinkedAi('output', 'insert')).toBe(true)
    expect(app.sendSelection).toHaveBeenCalledWith({ ...conversation, threadId: 'thread-two' }, 'output', 'insert')
    expect(app.aiSidebarVisible.value).toBe(true)
    expect(app.link.revealLinkedAiApproval('ai-host')).toBe(true)
    app.link.showLinkedAiOnly()
    expect(app.isHomeActive.value).toBe(true)
    expect(app.link.linkedTerminalSessionId.value).toBeUndefined()
  })
})
