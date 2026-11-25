import { computed, onScopeDispose, shallowRef, watch, type Ref } from 'vue'
import type { AiTerminalConversation } from '@/domain/ai/chat'
import type { HostKeyMismatchData } from '@/domain/app/security'
import type { ConnectionGroup } from '@/domain/session/types'

type AdoptSession = (connectionId: string, sessionId: string) => void | Promise<void>
type OpenAttempt = { conversation: AiTerminalConversation; viewRevision: number; confirming: boolean }

function conversationKey(conversation?: AiTerminalConversation | null) {
  if (!conversation || (conversation.sessionId && !conversation.threadId)) return undefined
  return conversation.draftId !== undefined
    ? `draft:${conversation.draftId}`
    : JSON.stringify([conversation.sessionId, conversation.threadId])
}

export function useAiTerminalLink(deps: {
  activeConversation: () => AiTerminalConversation | null | undefined
  isSshMode: Readonly<Ref<boolean>>
  isStandaloneAiActive: Readonly<Ref<boolean>>
  isDockerMode: Readonly<Ref<boolean>>
  activeSessionId: Readonly<Ref<string | null>>
  aiSidebarVisible: Ref<boolean>
  disconnectedSessionIds: Readonly<Ref<ReadonlySet<string>>>
  getGroup: (connectionId: string) => ConnectionGroup | null
  awaitingHostKey: (connectionId: string) => boolean
  connectTerminal: (connectionId: string) => Promise<string | null>
  adoptTerminalInBackground: AdoptSession
  selectTerminal: (sessionId: string) => void
  selectStandaloneAi: () => void
  sendSelection: (conversation: AiTerminalConversation, text: string, mode: 'send' | 'insert') => boolean
}) {
  const link = shallowRef<{ conversation: AiTerminalConversation; terminalSessionId: string }>()
  const pending = shallowRef<OpenAttempt>()
  const openingAiTerminal = computed(() => !!pending.value)
  let viewRevision = 0

  // Leaving the source invalidates its navigation intent, even if the user returns
  // before the connection finishes. The SSH session can still open in the background.
  watch([deps.isSshMode, deps.isStandaloneAiActive,
    () => deps.activeConversation()?.connectionId, () => conversationKey(deps.activeConversation())],
  () => { viewRevision++ }, { flush: 'sync' })
  onScopeDispose(() => { pending.value = undefined })

  function sameAiView(source: AiTerminalConversation, current: AiTerminalConversation) {
    return source.connectionId === current.connectionId && (source.sessionId
      ? source.sessionId === current.sessionId
      : source.draftId === current.draftId)
  }

  // Once the first message opens an AI session, the dock follows that session's
  // active thread just like a conversation that was linked after its first reply.
  watch(deps.activeConversation, current => {
    const saved = link.value
    if (saved && !saved.conversation.sessionId && current?.sessionId && sameAiView(saved.conversation, current)) {
      link.value = { ...saved, conversation: current }
    }
  }, { flush: 'sync' })

  const dockedAi = computed(() => {
    const saved = link.value
    const current = deps.activeConversation()
    if (!saved || !current || !sameAiView(saved.conversation, current)) return undefined
    const exists = deps.getGroup(current.connectionId)?.sessions.some(session => session.id === saved.terminalSessionId)
    if (exists) return { conversation: current, terminalSessionId: saved.terminalSessionId }
  })
  const hasDockedAi = computed(() => !!dockedAi.value)
  const linkedAiConversation = computed(() => {
    const dock = dockedAi.value
    if (!dock || !deps.isSshMode.value || deps.isStandaloneAiActive.value || deps.isDockerMode.value) return undefined
    if (dock.terminalSessionId === deps.activeSessionId.value) return dock.conversation
  })
  const hasLinkedAiView = computed(() => !!linkedAiConversation.value)
  const linkedAiSessionId = computed(() => linkedAiConversation.value?.sessionId)
  const linkedTerminalSessionId = computed(() => {
    const id = linkedAiConversation.value && link.value?.terminalSessionId
    return id && !deps.disconnectedSessionIds.value.has(id) ? id : undefined
  })
  const workspaceAiSessionId = computed(() => hasLinkedAiView.value ? linkedAiSessionId.value ?? null : deps.activeSessionId.value)

  function isCurrentConversation(target: AiTerminalConversation) {
    const current = deps.activeConversation()
    const key = conversationKey(target)
    return deps.isSshMode.value && deps.isStandaloneAiActive.value && !!key
      && current?.connectionId === target.connectionId && conversationKey(current) === key
  }

  function openBesideConversation(conversation: AiTerminalConversation, terminalSessionId: string) {
    link.value = { conversation, terminalSessionId }
    deps.selectTerminal(terminalSessionId)
    deps.aiSidebarVisible.value = true
  }

  function finishAttempt(attempt: OpenAttempt, terminalSessionId: string) {
    if (pending.value !== attempt) return
    if (attempt.viewRevision === viewRevision && isCurrentConversation(attempt.conversation)) {
      openBesideConversation(deps.activeConversation() ?? attempt.conversation, terminalSessionId)
    }
    pending.value = undefined
  }

  async function showAiTerminal(conversation: AiTerminalConversation) {
    if (pending.value || !isCurrentConversation(conversation)) return
    const { connectionId } = conversation
    const group = deps.getGroup(connectionId)
    const terminals = group?.sessions.filter(session => !session.pending && !deps.disconnectedSessionIds.value.has(session.id)) || []
    const previous = link.value
    const linked = previous && sameAiView(previous.conversation, conversation) && terminals.find(session => session.id === previous.terminalSessionId)
    const active = terminals.find(session => session.id === group?.activeSessionId)
    const reusable = linked || active || terminals.at(-1)
    if (reusable) {
      openBesideConversation(conversation, reusable.id)
      return
    }

    const attempt = { conversation: { ...conversation }, viewRevision, confirming: false }
    pending.value = attempt
    try {
      const terminalSessionId = await deps.connectTerminal(connectionId)
      if (terminalSessionId) finishAttempt(attempt, terminalSessionId)
    } finally {
      if (pending.value === attempt && !attempt.confirming && !deps.awaitingHostKey(connectionId)) pending.value = undefined
    }
  }

  // Progress also covers cancellation outside the dialog. An active confirmation
  // retains ownership until its adoption callback has finished.
  watch(() => pending.value && deps.awaitingHostKey(pending.value.conversation.connectionId), (waiting, wasWaiting) => {
    if (!waiting && wasWaiting && pending.value && !pending.value.confirming) pending.value = undefined
  })

  function attemptForPrompt(prompt: HostKeyMismatchData | null) {
    const attempt = pending.value
    return prompt && prompt.purpose !== 'ai' && attempt?.conversation.connectionId === prompt.connectionId ? attempt : undefined
  }

  async function confirmHostKey(prompt: HostKeyMismatchData | null, confirm: (adopt?: AdoptSession) => Promise<void>) {
    const attempt = attemptForPrompt(prompt)
    if (!attempt) return confirm()
    attempt.confirming = true
    try {
      await confirm(async (connectionId, sessionId) => {
        await deps.adoptTerminalInBackground(connectionId, sessionId)
        finishAttempt(attempt, sessionId)
      })
    } finally {
      attempt.confirming = false
      if (pending.value === attempt && !deps.awaitingHostKey(attempt.conversation.connectionId)) pending.value = undefined
    }
  }

  function rejectHostKey(prompt: HostKeyMismatchData | null) {
    if (attemptForPrompt(prompt)) pending.value = undefined
  }

  function undockAi() {
    if (!dockedAi.value) return
    if (hasLinkedAiView.value) deps.aiSidebarVisible.value = false
    link.value = undefined
  }

  function showLinkedAiOnly() {
    if (!hasLinkedAiView.value) return
    undockAi()
    deps.selectStandaloneAi()
  }

  function deliverSelectionToLinkedAi(text: string, mode: 'send' | 'insert'): boolean {
    const conversation = linkedAiConversation.value
    if (!conversation || !deps.sendSelection(conversation, text, mode)) return false
    deps.aiSidebarVisible.value = true
    return true
  }

  function revealLinkedAiApproval(sessionId: string): boolean {
    const dock = dockedAi.value
    if (!deps.isSshMode.value || !dock || sessionId !== dock.conversation.sessionId) return false
    if (!hasLinkedAiView.value) deps.selectTerminal(dock.terminalSessionId)
    deps.aiSidebarVisible.value = true
    return true
  }

  return { linkedAiSessionId, linkedTerminalSessionId, hasDockedAi, hasLinkedAiView, workspaceAiSessionId, openingAiTerminal, showAiTerminal, showLinkedAiOnly, undockAi,
    deliverSelectionToLinkedAi, revealLinkedAiApproval, confirmHostKey, rejectHostKey }
}
