import { computed, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import type { Connection } from '../../env.d'
import type { ConnectionGroup } from '@/domain/session/types'
import type { TerminalPwdTracker } from '@/domain/terminal/types'
import { useSessionActions } from './useSessionActions'

describe('useSessionActions cross-host split', () => {
  it('drops the current SSH host onto another host tab as an explicit split target', () => {
    const groups = ref<ConnectionGroup[]>([
      {
        connectionId: 'host-a',
        connectionName: 'web-01',
        sessions: [{ id: 'session-a', connectionId: 'host-a', connectionName: 'web-01', tabNumber: 1 }],
        activeSessionId: 'session-a',
        nextTabNumber: 2,
      },
      {
        connectionId: 'host-b',
        connectionName: 'db-01',
        sessions: [{ id: 'session-b', connectionId: 'host-b', connectionName: 'db-01', tabNumber: 1 }],
        activeSessionId: 'session-b',
        nextTabNumber: 2,
      },
    ])
    const onSelectGroup = vi.fn()
    const setSidebarTarget = vi.fn()
    const setPrimary = vi.fn()
    const setSecondary = vi.fn()
    const setSplitMode = vi.fn()

    const actions = useSessionActions({
      groups,
      connections: ref<Connection[]>([]),
      activeGroup: computed(() => groups.value[0]),
      pwdTracker: {} as TerminalPwdTracker,
      getGroupBySessionId: (sessionId) =>
        groups.value.find((group) => group.sessions.some((session) => session.id === sessionId)) ?? null,
      onSelectGroup,
      createSession: async () => null,
      removeSessionFromState: vi.fn(),
      onCloseSession: async () => {},
      onSessionClosed: vi.fn(),
      clearUnread: vi.fn(),
      setSidebarTarget,
      setSplitPreview: vi.fn(),
      setSplitPrimarySessionId: setPrimary,
      setSecondarySessionId: setSecondary,
      setSplitMode,
    })

    actions.onDragSplitCommit({
      mode: 'vertical',
      side: 'left',
      sessionId: 'session-a',
      primarySessionId: 'session-b',
    })

    expect(onSelectGroup).toHaveBeenCalledWith('host-b')
    expect(setSidebarTarget).toHaveBeenCalledWith('host-b', 'session-b')
    expect(setPrimary).toHaveBeenCalledWith('session-b')
    expect(setSecondary).toHaveBeenCalledWith('session-a')
    expect(setSplitMode).toHaveBeenCalledWith('vertical', 'left', 'session-b')
  })

  it('moves the active host and SFTP target when cross-host panes are swapped', () => {
    const groups = ref<ConnectionGroup[]>([
      {
        connectionId: 'host-a',
        connectionName: 'web-01',
        sessions: [{ id: 'session-a', connectionId: 'host-a', connectionName: 'web-01', tabNumber: 1 }],
        activeSessionId: 'session-a',
        nextTabNumber: 2,
      },
      {
        connectionId: 'host-b',
        connectionName: 'db-01',
        sessions: [{ id: 'session-b', connectionId: 'host-b', connectionName: 'db-01', tabNumber: 1 }],
        activeSessionId: 'session-b',
        nextTabNumber: 2,
      },
    ])
    const selectedGroups: string[] = []
    const sidebarTargets: Array<[string | null, string | null]> = []
    const setPrimary = vi.fn()
    const setSecondary = vi.fn()

    const actions = useSessionActions({
      groups,
      connections: ref<Connection[]>([]),
      activeGroup: computed(() => groups.value[0]),
      pwdTracker: {} as TerminalPwdTracker,
      getGroupBySessionId: (sessionId) =>
        groups.value.find((group) => group.sessions.some((session) => session.id === sessionId)) ?? null,
      onSelectGroup: (connectionId) => selectedGroups.push(connectionId),
      createSession: async () => null,
      removeSessionFromState: vi.fn(),
      onCloseSession: async () => {},
      onSessionClosed: vi.fn(),
      clearUnread: vi.fn(),
      setSidebarTarget: (connectionId, sessionId) => sidebarTargets.push([connectionId, sessionId]),
      setSplitPreview: vi.fn(),
      setSplitPrimarySessionId: setPrimary,
      setSecondarySessionId: setSecondary,
      setSplitMode: vi.fn(),
    })

    actions.onSwapSplitPanes({
      primarySessionId: 'session-a',
      secondarySessionId: 'session-b',
    })

    expect(selectedGroups).toEqual(['host-b'])
    expect(sidebarTargets).toEqual([['host-b', 'session-b']])
    expect(setPrimary).toHaveBeenCalledWith('session-b')
    expect(setSecondary).toHaveBeenCalledWith('session-a')
  })
})
