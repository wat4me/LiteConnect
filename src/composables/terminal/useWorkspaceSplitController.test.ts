import { computed, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { ConnectionGroup } from '@/domain/session/types'
import { useWorkspaceSplitController } from './useWorkspaceSplitController'

function makeGroup(connectionId: string, ids: string[]): ConnectionGroup {
  return {
    connectionId,
    connectionName: connectionId,
    sessions: ids.map((id, index) => ({
      id,
      connectionId,
      connectionName: connectionId,
      tabNumber: index + 1,
    })),
    activeSessionId: ids[0] ?? null,
    nextTabNumber: ids.length + 1,
  }
}

function setup() {
  const groups = ref([makeGroup('host-a', ['a1', 'a2']), makeGroup('host-b', ['b1'])])
  const splitVisible = ref(true)
  const primarySessionId = ref<string | null>('a1')
  const secondarySessionId = ref<string | null>('b1')
  const sidebarVisible = ref(true)
  const aiSidebarVisible = ref(false)
  const activeSessionId = computed(() => groups.value[0]?.activeSessionId ?? null)
  const getGroupBySessionId = (sessionId: string) =>
    groups.value.find((group) => group.sessions.some((session) => session.id === sessionId)) ?? null
  const closeSession = vi.fn(async (sessionId: string) => {
    const group = getGroupBySessionId(sessionId)
    if (!group) return
    group.sessions = group.sessions.filter((session) => session.id !== sessionId)
  })
  const controller = useWorkspaceSplitController({
    isSplit: computed(() => splitVisible.value),
    activeSessionId,
    primarySessionId,
    secondarySessionId,
    sidebarVisible,
    aiSidebarVisible,
    getGroupBySessionId,
    createSession: vi.fn(async () => null),
    closeSession,
    setSidebarTarget: vi.fn(),
    setPrimarySessionId: (id) => { primarySessionId.value = id },
    setSecondarySessionId: (id) => { secondarySessionId.value = id },
    closeSplit: () => { splitVisible.value = false },
    suspendSplit: () => { splitVisible.value = false },
    restoreSplit: () => { splitVisible.value = true },
  })
  return { groups, splitVisible, primarySessionId, secondarySessionId, sidebarVisible, aiSidebarVisible, closeSession, controller }
}

describe('useWorkspaceSplitController', () => {
  it('switches a terminal inside one SSH pane without leaving the host split', async () => {
    const state = setup()
    state.controller.selectSplitPaneSession({ side: 'primary', sessionId: 'a2' })
    await nextTick()
    expect(state.primarySessionId.value).toBe('a2')
    expect(state.groups.value[0].activeSessionId).toBe('a2')
    expect(state.splitVisible.value).toBe(true)
  })

  it('selects a replacement before closing a pane terminal', async () => {
    const state = setup()
    await state.controller.closeSplitPaneSession({ side: 'primary', sessionId: 'a1' })
    expect(state.primarySessionId.value).toBe('a2')
    expect(state.groups.value[0].activeSessionId).toBe('a2')
    expect(state.closeSession).toHaveBeenCalledWith('a1')
    expect(state.splitVisible.value).toBe(true)
  })

  it('hides SFTP for a cross-host split and restores the prior preference', async () => {
    const state = setup()
    state.splitVisible.value = false
    await nextTick()
    state.sidebarVisible.value = true
    state.splitVisible.value = true
    await nextTick()
    expect(state.controller.isCrossHostSplit.value).toBe(true)
    expect(state.sidebarVisible.value).toBe(false)

    state.splitVisible.value = false
    await nextTick()
    expect(state.sidebarVisible.value).toBe(true)
  })

  it('hides AI while a split is on screen and restores the previous choice', async () => {
    const state = setup()
    state.secondarySessionId.value = 'a2'
    state.splitVisible.value = false
    await nextTick()
    state.aiSidebarVisible.value = true
    state.splitVisible.value = true
    await nextTick()
    expect(state.controller.isCrossHostSplit.value).toBe(false)
    expect(state.aiSidebarVisible.value).toBe(false)

    state.splitVisible.value = false
    await nextTick()
    expect(state.aiSidebarVisible.value).toBe(true)
  })

  it('leaves AI closed when it was closed before the split', async () => {
    const state = setup()
    state.splitVisible.value = false
    await nextTick()
    state.aiSidebarVisible.value = false
    state.splitVisible.value = true
    await nextTick()
    expect(state.aiSidebarVisible.value).toBe(false)
    state.splitVisible.value = false
    await nextTick()
    expect(state.aiSidebarVisible.value).toBe(false)
  })
})
