<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import LeftToolbar from '@/components/workspace/LeftToolbar.vue'
import TerminalWorkspace from '@/components/terminal/TerminalWorkspace.vue'
import type { Connection } from '@/env.d'
import type {
  ConnectionGroup,
  Session,
  SplitDropPayload,
  SplitPaneAddPayload,
  SplitPaneSessionPayload,
  SplitPreviewPayload,
  SplitSwapPayload,
} from '@/domain/session/types'
import type { SplitMode, SplitSide } from '@/domain/terminal/types'
import type { BatchCommandTarget } from '@/domain/snippets/types'
import { getSnippetContext } from '@/utils/session/sessionDisplay'
import {
  ensureTransferListeners,
  globalActiveTransfers,
  teardownTransferListeners,
} from '@/composables/sftp/useTransfers'
import { scheduleAfterTerminalVisible } from '@/utils/terminal/workspaceTerminalFocus'

onMounted(() => {
  ensureTransferListeners()
})

onBeforeUnmount(() => {
  cancelPendingTerminalFocus?.()
  cancelPendingTerminalFocus = null
  teardownTransferListeners()
})

const FileSidebar = defineAsyncComponent(() => import('@/components/sftp/FileSidebar.vue'))
const MonitorPanel = defineAsyncComponent(() => import('@/components/monitor/MonitorPanel.vue'))
const AiSidebar = defineAsyncComponent(() => import('@/components/ai/AiSidebar.vue'))
const BatchCommandPanel = defineAsyncComponent(() => import('@/components/snippets/BatchCommandPanel.vue'))
const CommandSnippetsPanel = defineAsyncComponent(() => import('@/components/snippets/CommandSnippetsPanel.vue'))
const CommandSnippetPalette = defineAsyncComponent(() => import('@/components/snippets/CommandSnippetPalette.vue'))
const DockerWorkspace = defineAsyncComponent(() => import('@/components/docker/DockerWorkspace.vue'))

const props = defineProps<{
  activeGroup: ConnectionGroup | null
  activeSession: Session | null
  activeSessionId: string | null
  connections: Connection[]
  liveSessionIds: string[]
  /** All open sessions across host tabs — keep terminals mounted when switching hosts */
  allSessions: Session[]
  unreadSessions: Set<string>
  aiApprovalSessions?: Set<string>
  showAiUnread: boolean
  showAiApproval?: boolean

  aiSidebarVisible: boolean
  sidebarVisible: boolean
  /** Cross-host split owns the full SSH canvas; SFTP returns after leaving it. */
  sftpDisabled?: boolean
  /** Visible split closes AI; the previous choice returns when the split ends. */
  aiDisabled?: boolean
  sidebarWidth: number
  sidebarSessionId: string | null
  aiSelectionRequest: {
    id: number
    sessionId: string
    text: string
    mode: 'send' | 'insert'
  } | null

  monitorVisible: boolean
  monitorWidth: number
  batchPanelVisible: boolean
  snippetsPanelVisible: boolean
  snippetPaletteVisible?: boolean
  snippetDraftCommand?: string
  batchSessions: BatchCommandTarget[]
  batchInitialCommand: string

  splitMode: SplitMode
  splitRatio: number
  isSplit: boolean
  isResizing: boolean
  previewMode: SplitMode
  previewActive: boolean
  previewSide: SplitSide | null
  previewSessionId: string | null
  dividerSize: number
  splitPrimarySessionId: string | null
  secondarySessionId: string | null
  secondarySide: SplitSide

  /** Docker sub-tab is selected (main pane shows Docker, not a PTY). */
  dockerMode?: boolean
  /** Docker sub-tab exists on the current host (selected or not). */
  dockerTabOpen?: boolean
  dockerButtonEnabled?: boolean
  disconnectedSessionIds?: Set<string>
}>()

const emit = defineEmits<{
  (e: 'jump-ai-approval', sessionId: string): void
  (e: 'toggle-ai'): void
  (e: 'toggle-files'): void
  (e: 'toggle-monitor'): void
  (e: 'toggle-batch'): void
  (e: 'toggle-snippets'): void
  (e: 'toggle-docker'): void
  (e: 'select-docker'): void
  (e: 'close-docker'): void
  (e: 'back-to-terminal'): void
  (e: 'close-ai'): void
  (e: 'close-files'): void
  (e: 'close-monitor'): void
  (e: 'close-batch'): void
  (e: 'close-snippets'): void
  (e: 'close-snippet-palette'): void
  (e: 'clear-snippet-draft'): void
  (e: 'save-as-snippet', command: string): void
  (e: 'ai-selection-consumed', id: number): void
  (e: 'start-resize', event: MouseEvent): void
  (e: 'start-resize-right', event: MouseEvent): void
  (e: 'bind-file-sidebar', el: unknown): void

  (e: 'select-session', sessionId: string): void
  (e: 'close-session', sessionId: string): void
  (e: 'add-session', connectionId: string): void
  (e: 'session-closed', sessionId: string): void
  (e: 'reconnect', sessionId: string): void
  (e: 'cd-command', sessionId: string, command: string): void
  (e: 'pwd-output', sessionId: string, pwd: string): void
  (e: 'ai-selection', text: string, mode: 'send' | 'insert'): void
  (e: 'split-preview', payload: SplitPreviewPayload | null): void
  (e: 'split-commit', payload: SplitDropPayload): void
  (e: 'swap-split-panes', payload: SplitSwapPayload): void
  (e: 'close-split'): void
  (e: 'select-split'): void
  (e: 'toggle-horizontal'): void
  (e: 'toggle-vertical'): void
  (e: 'start-split-resize', event: MouseEvent, container: HTMLElement): void
  (e: 'reset-split-ratio'): void
  (e: 'set-secondary-session', sessionId: string): void
  (e: 'send-to-batch', command: string): void
  (e: 'clear-batch-initial'): void
  (e: 'bind-terminal-container', el: HTMLElement | null): void
  (e: 'select-split-pane-session', payload: SplitPaneSessionPayload): void
  (e: 'add-split-pane-session', payload: SplitPaneAddPayload): void
  (e: 'close-split-pane-session', payload: SplitPaneSessionPayload): void
}>()

const { t } = useI18n()

type WorkspacePane = 'ai' | 'sftp' | 'docker'

const workspaceCacheKeys = reactive<Record<WorkspacePane, string[]>>({
  ai: [],
  sftp: [],
  docker: [],
})
const aiFreshOpenTokens = reactive<Record<string, number>>({})
let aiFreshOpenCounter = 0
const dockerCacheSessionIds = reactive(new Map<string, string>())

function rememberOpenedKey(list: string[], key: string): string[] {
  return list.includes(key) ? list : [...list, key]
}

function rememberWorkspace(feature: WorkspacePane, key: string | null | undefined) {
  if (!key) return
  workspaceCacheKeys[feature] = rememberOpenedKey(workspaceCacheKeys[feature], key)
}

watch(
  () => props.liveSessionIds,
  (liveIds) => {
    const live = new Set(liveIds)
    const liveConnections = new Set(props.allSessions.map((session) => session.connectionId))
    for (const feature of ['ai', 'sftp'] as const) {
      workspaceCacheKeys[feature] = workspaceCacheKeys[feature].filter((key) => live.has(key))
    }
    workspaceCacheKeys.docker = workspaceCacheKeys.docker.filter((key) => liveConnections.has(key))
    for (const key of [...dockerCacheSessionIds.keys()]) {
      if (!liveConnections.has(key)) dockerCacheSessionIds.delete(key)
    }
  },
  { deep: true },
)

watch(
  [() => props.aiSidebarVisible, () => props.activeSession?.id],
  ([visible, sessionId], [wasVisible]) => {
    if (!visible || !sessionId) return
    rememberWorkspace('ai', sessionId as string)
    // A closed AI panel starts with a fresh draft the next time it is opened.
    // Do not increment on SSH tab switches while the panel remains visible.
    if (!wasVisible) {
      aiFreshOpenTokens[sessionId as string] = ++aiFreshOpenCounter
    }
  },
  { immediate: true },
)

watch(
  [() => props.sidebarVisible, () => props.aiSidebarVisible, () => props.sidebarSessionId],
  ([visible, aiVisible, sessionId]) => {
    if (visible && !aiVisible) rememberWorkspace('sftp', sessionId as string | null)
  },
  { immediate: true },
)

watch(
  [() => props.dockerTabOpen, () => props.activeGroup?.connectionId, () => props.activeSessionId],
  ([open, connectionId, sessionId]) => {
    if (open && connectionId && sessionId) {
      dockerCacheSessionIds.set(connectionId as string, sessionId as string)
      rememberWorkspace('docker', connectionId as string)
    }
  },
  { immediate: true },
)

function connectionNameForSession(sessionId: string): string {
  return props.allSessions.find((session) => session.id === sessionId)?.connectionName || ''
}

function connectionIdForSession(sessionId: string): string {
  return props.allSessions.find((session) => session.id === sessionId)?.connectionId || ''
}

/** Uses the stable session tabNumber; closing an earlier tab must not renumber this label. */
function terminalLabelForSession(sessionId: string): string {
  const session = props.allSessions.find((item) => item.id === sessionId)
  return session ? t('terminal.tabLabel', { n: session.tabNumber }) : ''
}

function dockerSessionId(connectionId: string): string {
  return dockerCacheSessionIds.get(connectionId) || ''
}

const approvalHint = computed(() => {
  const set = props.aiApprovalSessions
  if (!set || set.size === 0) return null
  const hidden: string[] = []
  for (const id of set) {
    if (!(id === props.activeSessionId && props.aiSidebarVisible)) hidden.push(id)
  }
  if (!hidden.length) return null
  const sessionId = hidden[0]
  const session = props.allSessions.find((item) => item.id === sessionId)
  return {
    sessionId,
    current: sessionId === props.activeSessionId,
    name: session?.connectionName || '',
    extra: hidden.length - 1,
  }
})

const terminalWorkspaceRef = ref<{
  focusActiveTerminal: () => boolean
} | null>(null)

/** Bottom dock is default; side panel opens only when user requests details. */
const monitorDetailsOpen = ref(false)

/** Any live PTY on this host can drive collection; metrics are per connection. */
const monitorExecSessionId = computed(() => {
  const group = props.activeGroup
  if (!group || group.sessions.length === 0) return ''
  if (group.activeSessionId && group.sessions.some((session) => session.id === group.activeSessionId)) {
    return group.activeSessionId
  }
  return group.sessions[0].id
})
/** Declared before onBeforeUnmount so unmount can cancel stale rAF focus. */
let cancelPendingTerminalFocus: (() => void) | null = null

/** After Docker→terminal, restore xterm keyboard focus (toolbar button steals focus). */
watch(
  () => props.dockerMode,
  async (docker, wasDocker) => {
    cancelPendingTerminalFocus?.()
    cancelPendingTerminalFocus = null
    if (wasDocker && !docker) {
      await nextTick()
      // If user already re-entered Docker, skip stale focus.
      if (props.dockerMode) return
      cancelPendingTerminalFocus = scheduleAfterTerminalVisible(() => {
        cancelPendingTerminalFocus = null
        if (props.dockerMode) return
        terminalWorkspaceRef.value?.focusActiveTerminal()
      })
    }
  },
)

function onSelectTerminal(sessionId: string) {
  if (props.dockerMode) emit('back-to-terminal')
  emit('select-session', sessionId)
}

watch(
  () => props.monitorVisible,
  (visible) => {
    if (!visible) monitorDetailsOpen.value = false
  },
)
</script>

<template>
  <div class="workspace-content">
    <LeftToolbar
      :ai-active="aiSidebarVisible"
      :files-active="sidebarVisible && !aiSidebarVisible"
      :monitor-active="monitorVisible"
      :batch-active="batchPanelVisible"
      :snippets-active="snippetsPanelVisible"
      :show-ai-unread="showAiUnread"
      :show-ai-approval="showAiApproval"
      :active-transfers="globalActiveTransfers"
      :docker-active="!!dockerMode"
      :docker-disabled="!dockerButtonEnabled && !dockerTabOpen"
      :files-disabled="sftpDisabled"
      :ai-disabled="aiDisabled"
      :side-panels-disabled="!!dockerMode"
      @toggle-ai="emit('toggle-ai')"
      @toggle-files="emit('toggle-files')"
      @toggle-monitor="emit('toggle-monitor')"
      @toggle-batch="emit('toggle-batch')"
      @toggle-snippets="emit('toggle-snippets')"
      @toggle-docker="emit('toggle-docker')"
    />

    <div
      v-show="activeSession && aiSidebarVisible"
      class="sidebar-panel"
      :style="{ width: sidebarWidth + 'px' }"
    >
      <AiSidebar
        v-for="sessionId in workspaceCacheKeys.ai"
        v-show="activeSession?.id === sessionId"
        :key="sessionId"
        :session-id="sessionId"
        :active="activeSession?.id === sessionId && aiSidebarVisible"
        :open-generation="aiFreshOpenTokens[sessionId] || 0"
        :selection-request="activeSession?.id === sessionId ? aiSelectionRequest : null"
        @close="emit('close-ai')"
        @selection-consumed="emit('ai-selection-consumed', $event)"
      />
    </div>
    <div
      v-show="activeSession && aiSidebarVisible"
      class="resize-handle"
      @mousedown="emit('start-resize', $event)"
    ></div>

    <!--
      Per-session SFTP panes. Keep explorers mounted so directory trees,
      expanded nodes, and scroll position survive tab changes. Closed
      sessions are removed immediately.
    -->
    <div
      v-show="!aiSidebarVisible && sidebarVisible && sidebarSessionId"
      class="sidebar-panel"
      :style="{ width: sidebarWidth + 'px' }"
    >
      <FileSidebar
        v-for="sessionId in workspaceCacheKeys.sftp"
        v-show="sidebarSessionId === sessionId"
        :key="sessionId"
        :ref="(el) => { if (sidebarSessionId === sessionId) emit('bind-file-sidebar', el) }"
        :session-id="sessionId"
        :connection-id="connectionIdForSession(sessionId)"
        :connection-name="connectionNameForSession(sessionId)"
        :terminal-label="terminalLabelForSession(sessionId)"
        @close="emit('close-files')"
      />
    </div>
    <div
      v-show="!aiSidebarVisible && sidebarVisible && sidebarSessionId"
      class="resize-handle"
      @mousedown="emit('start-resize', $event)"
    ></div>

    <div class="workspace-main">
      <div v-if="approvalHint" class="ai-approval-bar">
        <span class="ai-approval-bar-text">
          {{
            approvalHint.current
              ? t('ai.approvalHintCurrent')
              : t('ai.approvalHintNamed', { name: approvalHint.name })
          }}
          <template v-if="approvalHint.extra">{{ t('ai.approvalHintMore', { n: approvalHint.extra }) }}</template>
        </span>
        <button type="button" class="ai-approval-bar-btn" @click="emit('jump-ai-approval', approvalHint.sessionId)">
          {{ t('ai.approvalHintAction') }}
        </button>
      </div>
      <div class="terminal-host">
        <TerminalWorkspace
          ref="terminalWorkspaceRef"
          :active-group="activeGroup"
          :active-session="activeSession"
          :connections="connections"
          :all-sessions="allSessions"
          :live-session-ids="liveSessionIds"
          :unread-sessions="unreadSessions"
          :ai-approval-sessions="aiApprovalSessions"
          :split-mode="splitMode"
          :split-ratio="splitRatio"
          :is-split="isSplit"
          :is-resizing="isResizing"
          :preview-mode="previewMode"
          :preview-active="previewActive"
          :preview-side="previewSide"
          :preview-session-id="previewSessionId"
          :divider-size="dividerSize"
          :split-primary-session-id="splitPrimarySessionId"
          :secondary-session-id="secondarySessionId"
          :secondary-side="secondarySide"
          :workspace-visible="!dockerMode"
          :disconnected-session-ids="disconnectedSessionIds"
          :docker-tab-open="!!dockerTabOpen"
          :docker-tab-active="!!dockerMode"
          @select-session="onSelectTerminal"
          @close-session="emit('close-session', $event)"
          @add-session="emit('add-session', $event)"
          @session-closed="emit('session-closed', $event)"
          @reconnect="emit('reconnect', $event)"
          @cd-command="(sid, cmd) => emit('cd-command', sid, cmd)"
          @pwd-output="(sid, pwd) => emit('pwd-output', sid, pwd)"
          @ai-selection="(text, mode) => emit('ai-selection', text, mode)"
          @save-as-snippet="(cmd) => emit('save-as-snippet', cmd)"
          @split-preview="emit('split-preview', $event)"
          @split-commit="emit('split-commit', $event)"
          @swap-split-panes="emit('swap-split-panes', $event)"
          @close-split="emit('close-split')"
          @select-split="emit('select-split')"
          @toggle-horizontal="emit('toggle-horizontal')"
          @toggle-vertical="emit('toggle-vertical')"
          @start-split-resize="(e, el) => emit('start-split-resize', e, el)"
          @reset-split-ratio="emit('reset-split-ratio')"
          @set-secondary-session="emit('set-secondary-session', $event)"
          @bind-terminal-container="emit('bind-terminal-container', $event)"
          @select-split-pane-session="emit('select-split-pane-session', $event)"
          @add-split-pane-session="emit('add-split-pane-session', $event)"
          @close-split-pane-session="emit('close-split-pane-session', $event)"
          @select-docker="emit('select-docker')"
          @close-docker="emit('close-docker')"
        >
          <template #docker-pane>
            <template v-for="connectionId in workspaceCacheKeys.docker" :key="connectionId">
              <DockerWorkspace
                v-if="dockerSessionId(connectionId)"
                v-show="dockerTabOpen && activeGroup?.connectionId === connectionId"
                :session-id="dockerSessionId(connectionId)"
                :ssh-disconnected="disconnectedSessionIds?.has(dockerSessionId(connectionId)) === true"
                @back-to-terminal="emit('back-to-terminal')"
                @reconnect="emit('reconnect', dockerSessionId(connectionId))"
              />
            </template>
          </template>
        </TerminalWorkspace>
      </div>

      <div
        v-if="monitorVisible && activeGroup && activeGroup.sessions.length > 0"
        v-show="!monitorDetailsOpen"
        class="monitor-dock"
      >
        <MonitorPanel
          :key="'dock-' + activeGroup.connectionId"
          layout="bottom"
          :details-open="monitorDetailsOpen"
          :session-id="monitorExecSessionId"
          :connection-id="activeGroup.connectionId"
          :connection-name="activeGroup.connectionName"
          @close="emit('close-monitor')"
          @toggle-details="monitorDetailsOpen = true"
        />
      </div>
    </div>

    <CommandSnippetPalette
      :visible="!!snippetPaletteVisible"
      :session-id="activeSessionId"
      :snippet-context="activeSession ? getSnippetContext(connections, activeSession.connectionId) : null"
      :sessions="batchSessions.map((s) => ({
        id: s.id,
        label: s.displayName || s.terminalLabel || s.id,
        host: s.host,
        user: s.user,
        port: s.port,
        name: s.connectionName,
      }))"
      @close="emit('close-snippet-palette')"
    />

    <template v-if="snippetsPanelVisible">
      <div class="resize-handle" @mousedown="emit('start-resize-right', $event)"></div>
      <div class="batch-panel-wrapper">
        <CommandSnippetsPanel
          :session-id="activeSessionId"
          :snippet-context="activeSession ? getSnippetContext(connections, activeSession.connectionId) : null"
          :sessions="batchSessions.map((s) => ({
            id: s.id,
            label: s.displayName || s.terminalLabel || s.id,
            host: s.host,
            user: s.user,
            port: s.port,
            name: s.connectionName,
          }))"
          :draft-command="snippetDraftCommand"
          @close="emit('close-snippets')"
          @send-to-batch="emit('send-to-batch', $event)"
          @clear-draft="emit('clear-snippet-draft')"
        />
      </div>
    </template>

    <template v-if="batchPanelVisible && batchSessions.length > 0">
      <div class="resize-handle" @mousedown="emit('start-resize-right', $event)"></div>
      <div class="batch-panel-wrapper">
        <BatchCommandPanel
          :sessions="batchSessions"
          :initial-command="batchInitialCommand"
          @close="emit('close-batch')"
          @clear-initial="emit('clear-batch-initial')"
        />
      </div>
    </template>

    <template v-if="monitorVisible && monitorDetailsOpen && activeGroup && activeGroup.sessions.length > 0">
      <div class="resize-handle" @mousedown="emit('start-resize-right', $event)"></div>
      <div class="monitor-panel-wrapper" :style="{ width: monitorWidth + 'px' }">
        <MonitorPanel
          :key="'side-' + activeGroup.connectionId"
          layout="side"
          :session-id="monitorExecSessionId"
          :connection-id="activeGroup.connectionId"
          :connection-name="activeGroup.connectionName"
          @close="emit('close-monitor')"
          @dock="monitorDetailsOpen = false"
        />
      </div>
    </template>
  </div>
</template>

<style scoped>
.workspace-content {
  flex: 1;
  display: flex;
  overflow: hidden;
  min-width: 0;
}

.workspace-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.ai-approval-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--warning) 16%, var(--bg-secondary));
  border-bottom: 1px solid color-mix(in srgb, var(--warning) 40%, var(--border-color));
  color: var(--text-primary);
  font-size: 12px;
}

.ai-approval-bar-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ai-approval-bar-btn {
  flex-shrink: 0;
  height: 24px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: var(--warning);
  color: var(--bg-primary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.ai-approval-bar-btn:hover {
  filter: brightness(1.05);
}

.terminal-host {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

/* Cached Docker workspace host — fill remaining width like terminal */
.workspace-main > :deep(.docker-workspace) {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.monitor-dock {
  flex-shrink: 0;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
  overflow: hidden;
}

.sidebar-panel {
  flex-shrink: 0;
  overflow: hidden;
  transition: opacity 0.15s ease;
}

.resize-handle {
  width: 4px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s;
  flex-shrink: 0;
}

.resize-handle:hover {
  background: var(--accent);
}

.batch-panel-wrapper {
  width: 320px;
  min-width: 280px;
  max-width: 500px;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  overflow: hidden;
  flex-shrink: 0;
}

.monitor-panel-wrapper {
  flex-shrink: 0;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  overflow: hidden;
}
</style>
