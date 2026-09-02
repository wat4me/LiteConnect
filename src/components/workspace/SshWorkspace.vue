<script setup lang="ts">
import { defineAsyncComponent, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import LeftToolbar from '@/components/workspace/LeftToolbar.vue'
import TerminalWorkspace from '@/components/terminal/TerminalWorkspace.vue'
import type { Connection } from '@/env.d'
import type { ConnectionGroup, Session, SplitDropPayload } from '@/domain/session/types'
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
  showAiUnread: boolean

  aiSidebarVisible: boolean
  sidebarVisible: boolean
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
  previewSide: SplitSide | null
  dividerSize: number
  secondarySessionId: string | null
  secondarySide: SplitSide

  /** Workspace mode: docker hides side panels and fills remaining width. */
  dockerMode?: boolean
  dockerButtonEnabled?: boolean
  /** SSH closed for active session (still open tab). */
  activeSessionSshDisconnected?: boolean
  disconnectedSessionIds?: Set<string>
}>()

const emit = defineEmits<{
  (e: 'toggle-ai'): void
  (e: 'toggle-files'): void
  (e: 'toggle-monitor'): void
  (e: 'toggle-batch'): void
  (e: 'toggle-snippets'): void
  (e: 'toggle-docker'): void
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
  (e: 'split-preview', payload: SplitDropPayload | null): void
  (e: 'split-commit', payload: SplitDropPayload): void
  (e: 'toggle-horizontal'): void
  (e: 'toggle-vertical'): void
  (e: 'start-split-resize', event: MouseEvent, container: HTMLElement): void
  (e: 'reset-split-ratio'): void
  (e: 'set-secondary-session', sessionId: string): void
  (e: 'send-to-batch', command: string): void
  (e: 'clear-batch-initial'): void
  (e: 'back-to-terminal'): void
}>()

const terminalWorkspaceRef = ref<{
  focusActiveTerminal: () => boolean
} | null>(null)

/** Bottom dock is default; side panel opens only when user requests details. */
const monitorDetailsOpen = ref(false)
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

const showSidePanels = () => !props.dockerMode

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
      :active-transfers="globalActiveTransfers"
      :docker-active="!!dockerMode"
      :docker-disabled="!dockerButtonEnabled && !dockerMode"
      :side-panels-disabled="!!dockerMode"
      @toggle-ai="emit('toggle-ai')"
      @toggle-files="emit('toggle-files')"
      @toggle-monitor="emit('toggle-monitor')"
      @toggle-batch="emit('toggle-batch')"
      @toggle-snippets="emit('toggle-snippets')"
      @toggle-docker="emit('toggle-docker')"
    />

    <div
      v-show="showSidePanels() && activeSession && aiSidebarVisible"
      class="sidebar-panel"
      :style="{ width: sidebarWidth + 'px' }"
    >
      <KeepAlive :max="12">
        <AiSidebar
          v-if="activeSession"
          :key="activeSession.id"
          :session-id="activeSession.id"
          :selection-request="aiSelectionRequest"
          @close="emit('close-ai')"
          @selection-consumed="emit('ai-selection-consumed', $event)"
        />
      </KeepAlive>
    </div>
    <div
      v-show="showSidePanels() && activeSession && aiSidebarVisible"
      class="resize-handle"
      @mousedown="emit('start-resize', $event)"
    ></div>

    <!--
      Per-session SFTP cache. Like DockerWorkspace, retain recent explorers so
      directory trees, expanded nodes, and scroll position survive tab changes.
      KeepAlive evicts the least-recently-used instance once the 12-session cap
      is reached; the evicted session will initialize again when revisited.
    -->
    <div
      v-show="showSidePanels() && !aiSidebarVisible && sidebarVisible && sidebarSessionId"
      class="sidebar-panel"
      :style="{ width: sidebarWidth + 'px' }"
    >
      <KeepAlive :max="12">
        <FileSidebar
          v-if="sidebarSessionId"
          :key="sidebarSessionId"
          :ref="(el) => emit('bind-file-sidebar', el)"
          :session-id="sidebarSessionId"
          :connection-name="activeGroup?.connectionName || ''"
          @close="emit('close-files')"
        />
      </KeepAlive>
    </div>
    <div
      v-show="showSidePanels() && !aiSidebarVisible && sidebarVisible && sidebarSessionId"
      class="resize-handle"
      @mousedown="emit('start-resize', $event)"
    ></div>

    <div class="workspace-main">
      <!-- Keep TerminalWorkspace mounted (v-show) so xterm is never destroyed in Docker mode -->
      <div v-show="!dockerMode" class="terminal-host">
        <TerminalWorkspace
          ref="terminalWorkspaceRef"
          :active-group="activeGroup"
          :active-session="activeSession"
          :connections="connections"
          :all-sessions="allSessions"
          :live-session-ids="liveSessionIds"
          :unread-sessions="unreadSessions"
          :split-mode="splitMode"
          :split-ratio="splitRatio"
          :is-split="isSplit"
          :is-resizing="isResizing"
          :preview-mode="previewMode"
          :preview-side="previewSide"
          :divider-size="dividerSize"
          :secondary-session-id="secondarySessionId"
          :secondary-side="secondarySide"
          :workspace-visible="!dockerMode"
          :disconnected-session-ids="disconnectedSessionIds"
          @select-session="emit('select-session', $event)"
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
          @toggle-horizontal="emit('toggle-horizontal')"
          @toggle-vertical="emit('toggle-vertical')"
          @start-split-resize="(e, el) => emit('start-split-resize', e, el)"
          @reset-split-ratio="emit('reset-split-ratio')"
          @set-secondary-session="emit('set-secondary-session', $event)"
        />
      </div>

      <!--
        Per-session KeepAlive: A in Docker → switch to B terminal → back to A
        must restore the same DockerWorkspace instance (list/selection/scroll),
        not remount and re-probe. key=sessionId so modes never leak across sessions.
      -->
      <KeepAlive :max="12">
        <DockerWorkspace
          v-if="dockerMode && activeSessionId"
          :key="activeSessionId"
          :session-id="activeSessionId"
          :ssh-disconnected="!!activeSessionSshDisconnected"
          @back-to-terminal="emit('back-to-terminal')"
          @reconnect="activeSessionId && emit('reconnect', activeSessionId)"
        />
      </KeepAlive>

      <div
        v-if="showSidePanels() && monitorVisible && activeGroup && activeGroup.sessions.length > 0"
        class="monitor-dock"
      >
        <MonitorPanel
          :key="'dock-' + activeGroup.connectionId"
          layout="bottom"
          :details-open="monitorDetailsOpen"
          :session-id="activeGroup.sessions[0].id"
          :connection-id="activeGroup.connectionId"
          :connection-name="activeGroup.connectionName"
          @close="emit('close-monitor')"
          @toggle-details="monitorDetailsOpen = !monitorDetailsOpen"
        />
      </div>
    </div>

    <CommandSnippetPalette
      :visible="!!snippetPaletteVisible && showSidePanels()"
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

    <template v-if="showSidePanels() && snippetsPanelVisible">
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

    <template v-if="showSidePanels() && batchPanelVisible && batchSessions.length > 0">
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

    <template v-if="showSidePanels() && monitorVisible && monitorDetailsOpen && activeGroup && activeGroup.sessions.length > 0">
      <div class="resize-handle" @mousedown="emit('start-resize-right', $event)"></div>
      <div class="monitor-panel-wrapper" :style="{ width: monitorWidth + 'px' }">
        <MonitorPanel
          :key="'side-' + activeGroup.connectionId"
          layout="side"
          :session-id="activeGroup.sessions[0].id"
          :connection-id="activeGroup.connectionId"
          :connection-name="activeGroup.connectionName"
          @close="monitorDetailsOpen = false"
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

.terminal-host {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

/* KeepAlive host for DockerWorkspace — fill remaining width like terminal */
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
