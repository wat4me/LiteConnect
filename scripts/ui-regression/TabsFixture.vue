<script setup lang="ts">
import { computed, provide, ref } from 'vue'
import TabBar from '../../src/components/app/TabBar.vue'
import TerminalWorkspace from '../../src/components/terminal/TerminalWorkspace.vue'
import { useSessionManager } from '../../src/composables/session/useSessionManager'
import { useTerminalPwd } from '../../src/composables/terminal/useTerminalPwd'
import { useTheme } from '../../src/composables/app/useTheme'
import type { Connection } from '../../src/env'

const connections: Connection[] = Array.from({ length: 15 }, (_, index) => ({
  id: `host-${index}`,
  name: `10.2.5.${70 + index}`,
  host: `10.2.5.${70 + index}`,
  port: 22,
  username: 'ops',
  password: '',
  group: '',
  createdAt: 1,
  updatedAt: 1,
}))
let newSessionCount = 0
const unsubscribe = () => () => {}

window.LiteConnect = {
  onMcpJobsChanged: unsubscribe,
  mcpListJobs: async () => [],
  sshConnect: async (id: string) => `${id}-new-${++newSessionCount}`,
  sftpExecHome: async () => '/home/ops',
  recordRecentConnection: async () => {},
  getRecentConnections: async () => [],
  getConnectionUsageStatsEnabled: async () => false,
  getAllSettings: async () => ({}),
  getTerminalFontSize: async () => 14,
  getTerminalFontFamily: async () => 'Consolas, monospace',
  getTerminalPalette: async () => 'auto',
  getTerminalScrollback: async () => 5000,
  getTerminalPasteConfirmEnabled: async () => false,
  getTerminalPasteConfirmMaxChars: async () => 500,
  getTerminalCommandSuggestEnabled: async () => false,
  getAutoReconnectEnabled: async () => false,
  getAutoReconnectMaxRetries: async () => 5,
  onRuntimeSettingsChanged: unsubscribe,
  sshWrite: () => {},
  sshResize: () => {},
  sshSetOutputPaused: () => {},
  sshTakeStartupNotices: async () => [],
  onSshData: (id: string, receive: (text: string) => void) => {
    queueMicrotask(() => receive(`Connected to ${id}\r\n`))
    return () => {}
  },
  onSshClosed: unsubscribe,
  onSshError: unsubscribe,
} as unknown as typeof window.LiteConnect

const pwdTracker = useTerminalPwd({ isDirectory: async () => true })
const theme = useTheme()
provide('pwdTracker', pwdTracker)
provide('theme', theme.theme)
provide('customColors', theme.customColors)

const sessionManager = useSessionManager({ pwdTracker })
const { groups, activeGroupId, isHomeActive, activeGroup, activeSession, onSelectGroup, onSelectSession, createSession } = sessionManager
sessionManager.hydrateConnectionData({ connections, recentConnections: [] })
sessionManager.connectSidebar({
  sidebarVisible: ref(false),
  aiSidebarVisible: ref(false),
  sidebarGroupId: ref(null),
  sidebarSessionId: ref(null),
  fileSidebarRef: ref(null),
  setSidebarTarget: () => {},
  syncSidebarState: () => {},
})
groups.value = connections.slice(0, 14).map((connection, index) => {
  const count = index === 13 ? 14 : 1
  const sessions = Array.from({ length: count }, (_, i) => ({
    id: `${connection.id}-session-${i + 1}`,
    connectionId: connection.id,
    connectionName: connection.name,
    tabNumber: i + 1,
    label: count > 1 ? `Terminal session ${i + 1}` : undefined,
  }))
  return { connectionId: connection.id, connectionName: connection.name, sessions, activeSessionId: sessions[0].id, nextTabNumber: count + 1 }
})
onSelectGroup('host-13')
const allSessions = computed(() => groups.value.flatMap(group => group.sessions))
const liveSessionIds = computed(() => allSessions.value.map(session => session.id))
const unreadSessions = new Set<string>()

;(window as any).__tabs = {
  setActive: onSelectGroup,
  connect: createSession,
  state: () => ({ active: activeGroupId.value, session: activeSession.value?.id, count: groups.value.length }),
}
</script>

<template>
  <div class="tabs-fixture">
    <TabBar
      :groups="groups"
      :active-group-id="activeGroupId"
      :recent-connections="[]"
      :latency-map="null"
      :latency-enabled="false"
      :home-active="isHomeActive"
      @select="onSelectGroup"
    />
    <TerminalWorkspace
      :active-group="activeGroup"
      :active-session="activeSession"
      :all-sessions="allSessions"
      :live-session-ids="liveSessionIds"
      :connections="connections"
      :unread-sessions="unreadSessions"
      split-mode="none"
      :split-ratio="0.5"
      :is-split="false"
      :is-resizing="false"
      preview-mode="none"
      :preview-active="false"
      :preview-side="null"
      :preview-session-id="null"
      :divider-size="5"
      :split-primary-session-id="null"
      :secondary-session-id="null"
      :secondary-side="null"
      @add-session="createSession"
      @select-session="onSelectSession"
    />
  </div>
</template>

<style scoped>
.tabs-fixture {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}
</style>
