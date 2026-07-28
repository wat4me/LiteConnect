<script setup lang="ts">
import { computed, defineAsyncComponent, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Connection } from '../../env.d'
import type { ConnectionGroup, Session } from '../../composables/session/useSessionManager'
import type { SplitMode, SplitSide } from '../../composables/terminal/useSplitTerminal'
import {
  getSessionSshAddress,
  getSshAddress,
  getTerminalLabel,
} from '../../utils/sessionDisplay'
import {
  focusPrimaryTerminalTab,
  type FocusableTerminalTab,
} from '../../utils/workspaceTerminalFocus'
import AppIcon from '../icons/AppIcon.vue'

const TerminalTab = defineAsyncComponent(() => import('./TerminalTab.vue'))
const SubTabBar = defineAsyncComponent(() => import('../SubTabBar.vue'))

const { t } = useI18n()

const props = withDefaults(
  defineProps<{
    activeGroup: ConnectionGroup | null
    activeSession: Session | null
    connections: Connection[]
    /**
     * Every open session across all host tabs. Must stay mounted so xterm
     * scrollback is not wiped when switching TabBar hosts.
     */
    allSessions: Session[]
    /** All open session ids across groups — used to drop retained panes after close */
    liveSessionIds: string[]
    unreadSessions: Set<string>
    splitMode: SplitMode
    splitRatio: number
    isSplit: boolean
    isResizing: boolean
    previewMode: SplitMode
    previewSide: SplitSide | null
    dividerSize: number
    secondarySessionId: string | null
    secondarySide: SplitSide
    /**
     * False when Docker (or other) workspace hides the terminal host via v-show.
     * Keeps TerminalTab/xterm mounted; only freezes foreground paint/resize.
     */
    workspaceVisible?: boolean
  }>(),
  { workspaceVisible: true },
)

const emit = defineEmits<{
  (e: 'select-session', sessionId: string): void
  (e: 'close-session', sessionId: string): void
  (e: 'add-session', connectionId: string): void
  (e: 'session-closed', sessionId: string): void
  (e: 'reconnect', sessionId: string): void
  (e: 'reconnect-all', connectionId: string): void
  (e: 'cd-command', sessionId: string, command: string): void
  (e: 'pwd-output', sessionId: string, pwd: string): void
  (e: 'ai-selection', text: string, mode: 'send' | 'insert'): void
  (e: 'save-as-snippet', command: string): void
  (e: 'split-preview', payload: { mode: 'horizontal' | 'vertical'; side: SplitSide; sessionId: string } | null): void
  (e: 'split-commit', payload: { mode: 'horizontal' | 'vertical'; side: SplitSide; sessionId: string }): void
  (e: 'toggle-horizontal'): void
  (e: 'toggle-vertical'): void
  (e: 'start-split-resize', event: MouseEvent, container: HTMLElement): void
  (e: 'reset-split-ratio'): void
  (e: 'set-secondary-session', sessionId: string): void
}>()

type TerminalTabExpose = FocusableTerminalTab & { sessionId?: string }

/** sessionId → mounted TerminalTab expose (stable while pane kept alive). */
const terminalTabRefs = new Map<string, TerminalTabExpose>()

function bindTerminalTabRef(sessionId: string, el: unknown) {
  if (!el || typeof el !== 'object') {
    terminalTabRefs.delete(sessionId)
    return
  }
  const inst = el as TerminalTabExpose
  if (typeof inst.focusTerminal === 'function') {
    terminalTabRefs.set(sessionId, inst)
  } else {
    terminalTabRefs.delete(sessionId)
  }
}

/** Focus primary active session xterm only (not secondary split / background). */
function focusActiveTerminal(): boolean {
  return focusPrimaryTerminalTab(
    terminalTabRefs,
    props.activeSession?.id ?? null,
    props.liveSessionIds,
  )
}

function getActiveTerminalContext(maxLines = 80): {
  selection: string
  scrollback: string
} {
  const sid = props.activeSession?.id
  if (!sid) return { selection: '', scrollback: '' }
  const tab = terminalTabRefs.get(sid) as
    | (TerminalTabExpose & {
        getTerminalContextText?: (n?: number) => { selection: string; scrollback: string }
      })
    | undefined
  if (tab && typeof tab.getTerminalContextText === 'function') {
    return tab.getTerminalContextText(maxLines)
  }
  return { selection: '', scrollback: '' }
}

defineExpose({
  focusActiveTerminal,
  getActiveTerminalContext,
})

const terminalContainerRef = ref<HTMLElement | null>(null)

const secondarySession = computed(() => {
  if (!props.activeGroup || props.activeGroup.sessions.length < 2) return null
  const activeId = props.activeGroup.activeSessionId
  if (props.secondarySessionId) {
    const picked = props.activeGroup.sessions.find(
      (s) => s.id === props.secondarySessionId && s.id !== activeId,
    )
    if (picked) return picked
    // Dragged the active tab: treat that tab as secondary by switching primary
    // is handled at commit time; here fall through to auto-pick.
  }
  return props.activeGroup.sessions.find((s) => s.id !== activeId) || props.activeGroup.sessions[1]
})

const secondaryCandidates = computed(() => {
  if (!props.activeGroup || !props.activeSession) return []
  return props.activeGroup.sessions.filter((s) => s.id !== props.activeSession!.id)
})

const splitHasSecondary = computed(() => props.isSplit && !!secondarySession.value)

const showSessionTabs = computed(() => {
  if (!props.activeGroup || props.activeGroup.sessions.length === 0) return false
  return !(splitHasSecondary.value && props.activeGroup.sessions.length === 2)
})

const showSplitModeBar = computed(
  () => splitHasSecondary.value && !showSessionTabs.value && !!props.activeGroup,
)

const activeGroupSshAddress = computed(() => {
  if (!props.activeGroup) return ''
  return getSshAddress(props.connections, props.activeGroup.connectionId)
})

/**
 * Mount TerminalTab for every live session (all host tabs), not only the
 * active group. Visibility is controlled via absolute layout + display:none.
 *
 * Previous bug: renderedSessions = activeGroup.sessions only → switching host
 * A→B unmounted A's xterm (dispose + empty scrollback). Returning to A remounted
 * a fresh TerminalTab that only printed "Connecting to…".
 *
 * When activeGroup is null (connection home), App still keeps SshWorkspace
 * mounted via v-show; allSessions from open groups keeps panes alive.
 */
const renderedSessions = computed(() => {
  const live = new Set(props.liveSessionIds)
  // Prefer explicit allSessions; fall back to active group if parent omitted list
  const source =
    props.allSessions.length > 0
      ? props.allSessions
      : props.activeGroup?.sessions ?? []
  return source.filter((s) => live.has(s.id) || live.size === 0)
})

function sessionSshAddress(session: Session | null | undefined): string {
  return getSessionSshAddress(props.connections, session)
}

/** Keep every session mounted; only layout/visibility changes — avoids dual-KeepAlive remount wipe. */
function isSessionVisible(sessionId: string): boolean {
  if (!props.activeSession) return false
  if (sessionId === props.activeSession.id) return true
  if (splitHasSecondary.value && secondarySession.value?.id === sessionId) return true
  return false
}

function isPrimarySession(sessionId: string): boolean {
  return !!props.activeSession && sessionId === props.activeSession.id
}

function isSecondarySession(sessionId: string): boolean {
  return splitHasSecondary.value && secondarySession.value?.id === sessionId
}

/**
 * Absolute layout so panes never move TerminalTab between different parents
 * (DOM moves would remount xterm and drop scrollback).
 * splitRatio always represents the primary pane's share; the secondary pane
 * takes the opposite side per secondarySide.
 */
function getSessionPaneStyle(sessionId: string): Record<string, string> {
  const half = props.dividerSize / 2
  const ratio = props.splitRatio
  const secRatio = 100 - ratio

  if (!splitHasSecondary.value) {
    if (!isPrimarySession(sessionId)) {
      return { display: 'none' }
    }
    return { top: '0', left: '0', right: '0', bottom: '0' }
  }

  const side = props.secondarySide
  const isVertical = props.splitMode === 'vertical'
  const primaryIsLeft = isVertical && side === 'right'
  const primaryIsRight = isVertical && side === 'left'
  const primaryIsTop = !isVertical && side === 'bottom'
  const primaryIsBottom = !isVertical && side === 'top'

  if (isPrimarySession(sessionId)) {
    if (primaryIsLeft) {
      return { top: '0', left: '0', bottom: '0', width: `calc(${ratio}% - ${half}px)` }
    }
    if (primaryIsRight) {
      return { top: '0', right: '0', bottom: '0', width: `calc(${ratio}% - ${half}px)` }
    }
    if (primaryIsTop) {
      return { top: '0', left: '0', right: '0', height: `calc(${ratio}% - ${half}px)` }
    }
    // primaryIsBottom
    return { bottom: '0', left: '0', right: '0', height: `calc(${ratio}% - ${half}px)` }
  }

  if (isSecondarySession(sessionId)) {
    if (primaryIsLeft) {
      // secondary on right
      return { top: '0', right: '0', bottom: '0', width: `calc(${secRatio}% - ${half}px)` }
    }
    if (primaryIsRight) {
      // secondary on left
      return { top: '0', left: '0', bottom: '0', width: `calc(${secRatio}% - ${half}px)` }
    }
    if (primaryIsTop) {
      // secondary on bottom
      return { bottom: '0', left: '0', right: '0', height: `calc(${secRatio}% - ${half}px)` }
    }
    // secondary on top
    return { top: '0', left: '0', right: '0', height: `calc(${secRatio}% - ${half}px)` }
  }

  // Mounted but hidden (other tabs) - preserve xterm instance & scrollback
  return { display: 'none' }
}

function getDividerStyle(): Record<string, string> {
  const half = props.dividerSize / 2
  const ratio = props.splitRatio
  const side = props.secondarySide
  if (props.splitMode === 'vertical') {
    if (side === 'left') {
      // secondary on left => divider sits at (100 - ratio)% from left
      return { top: '0', bottom: '0', left: `calc(${100 - ratio}% - ${half}px)`, width: `${props.dividerSize}px` }
    }
    // secondary on right (default) => divider at ratio% from left
    return { top: '0', bottom: '0', left: `calc(${ratio}% - ${half}px)`, width: `${props.dividerSize}px` }
  }
  // horizontal
  if (side === 'top') {
    return { left: '0', right: '0', top: `calc(${100 - ratio}% - ${half}px)`, height: `${props.dividerSize}px` }
  }
  // secondary on bottom (default)
  return { left: '0', right: '0', top: `calc(${ratio}% - ${half}px)`, height: `${props.dividerSize}px` }
}

function onSplitDividerMousedown(e: MouseEvent) {
  if (terminalContainerRef.value) {
    emit('start-split-resize', e, terminalContainerRef.value)
  }
}

function onDragSplitPreview(payload: { mode: 'horizontal' | 'vertical'; side: SplitSide; sessionId: string } | null) {
  emit('split-preview', payload)
}

function onDragSplitCommit(payload: { mode: 'horizontal' | 'vertical'; side: SplitSide; sessionId: string }) {
  emit('split-commit', payload)
}
</script>

<template>
  <div class="terminal-section">
    <SubTabBar
      v-if="showSessionTabs && activeGroup && activeGroup.sessions.length > 0"
      :sessions="activeGroup.sessions"
      :active-session-id="activeGroup.activeSessionId"
      :connection-id="activeGroup.connectionId"
      :unread-sessions="unreadSessions"
      :terminal-container="terminalContainerRef"
      @select="emit('select-session', $event)"
      @close="emit('close-session', $event)"
      @add="emit('add-session', $event)"
      @split-preview="onDragSplitPreview"
      @split-commit="onDragSplitCommit"
    >
      <template #actions>
        <div class="terminal-layout-actions">
          <span class="layout-action-label">{{ t('terminal.layout') }}</span>
          <button
            class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
            type="button"
            :class="{ active: splitMode === 'horizontal' }"
            :title="t('terminal.splitHorizontal')"
            @click="emit('toggle-horizontal')"
          >
            <AppIcon name="split-h" size="sm" />
          </button>
          <button
            class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
            type="button"
            :class="{ active: splitMode === 'vertical' }"
            :title="t('terminal.splitVertical')"
            @click="emit('toggle-vertical')"
          >
            <AppIcon name="split-v" size="sm" />
          </button>
        </div>
      </template>
    </SubTabBar>

    <div v-else-if="showSplitModeBar && activeGroup" class="split-mode-bar">
      <div class="split-mode-info">
        <span class="split-mode-name">{{ activeGroup.connectionName }}</span>
        <span v-if="activeGroupSshAddress" class="split-mode-meta">{{ activeGroupSshAddress }}</span>
      </div>
      <div class="terminal-layout-actions">
        <span class="layout-action-label">{{ t('terminal.layout') }}</span>
        <button
          class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
          type="button"
          :title="t('terminal.newTerminal')"
          @click="emit('add-session', activeGroup.connectionId)"
        >
          <AppIcon name="plus" size="sm" />
        </button>
        <button
          class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
          type="button"
          :class="{ active: splitMode === 'horizontal' }"
          :title="t('terminal.splitHorizontal')"
          @click="emit('toggle-horizontal')"
        >
          <AppIcon name="split-h" size="sm" />
        </button>
        <button
          class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
          type="button"
          :class="{ active: splitMode === 'vertical' }"
          :title="t('terminal.splitVertical')"
          @click="emit('toggle-vertical')"
        >
          <AppIcon name="split-v" size="sm" />
        </button>
      </div>
    </div>

    <div
      ref="terminalContainerRef"
      class="terminal-container"
      :class="{
        'is-split': splitHasSecondary,
        'split-horizontal': splitHasSecondary && splitMode === 'horizontal',
        'split-vertical': splitHasSecondary && splitMode === 'vertical',
      }"
    >
      <div
        v-if="previewMode !== 'none'"
        class="split-preview-overlay"
        :class="{
          horizontal: previewMode === 'horizontal',
          vertical: previewMode === 'vertical',
        }"
      >
        <div
          class="split-preview-zone"
          :class="{
            'drop-left': previewSide === 'left',
            'drop-right': previewSide === 'right',
            'drop-top': previewSide === 'top',
            'drop-bottom': previewSide === 'bottom',
          }"
        >
          <div class="split-preview-zone-inner">
            <AppIcon :name="previewMode === 'vertical' ? 'split-v' : 'split-h'" size="xl" />
            <span class="split-preview-zone-text">
              {{
                previewSide === 'left'
                  ? t('terminal.sideLeft')
                  : previewSide === 'right'
                    ? t('terminal.sideRight')
                    : previewSide === 'top'
                      ? t('terminal.sideTop')
                      : t('terminal.sideBottom')
              }}
            </span>
          </div>
        </div>
      </div>

      <!--
        One TerminalTab per session, stable :key.
        Never move between primary/secondary parent trees — only change absolute geometry.
      -->
      <div
        v-for="session in renderedSessions"
        :key="session.id"
        class="terminal-pane"
        :class="{
          'is-primary': isPrimarySession(session.id),
          'is-secondary': isSecondarySession(session.id),
          'is-hidden-session': !isSessionVisible(session.id),
        }"
        :style="getSessionPaneStyle(session.id)"
      >
        <div
          v-if="splitHasSecondary && isSessionVisible(session.id)"
          class="split-pane-header"
          :title="sessionSshAddress(session) || session.connectionName"
        >
          <div class="split-pane-info">
            <select
              v-if="isSecondarySession(session.id) && secondaryCandidates.length > 1"
              class="split-session-select"
              :value="session.id"
              @change="emit('set-secondary-session', ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="s in secondaryCandidates" :key="s.id" :value="s.id">
                {{ getTerminalLabel(s) }}
              </option>
            </select>
            <span v-else class="split-pane-tag">{{ getTerminalLabel(session) }}</span>
            <span class="split-pane-name">{{ session.connectionName }}</span>
            <span v-if="sessionSshAddress(session)" class="split-pane-meta">
              {{ sessionSshAddress(session) }}
            </span>
          </div>
          <button
            class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close"
            type="button"
            :title="t('terminal.closeSession', { label: getTerminalLabel(session) })"
            :aria-label="t('terminal.closeSession', { label: getTerminalLabel(session) })"
            @click="emit('close-session', session.id)"
          >
            <AppIcon name="close" size="xs" />
          </button>
        </div>
        <div class="terminal-pane-body">
          <TerminalTab
            :ref="(el) => bindTerminalTabRef(session.id, el)"
            :session-id="session.id"
            :connection-name="session.connectionName"
            :connection-id="session.connectionId"
            :active="isSessionVisible(session.id)"
            :workspace-visible="workspaceVisible !== false"
            @closed="emit('session-closed', $event)"
            @cd-command="(sid, cmd) => emit('cd-command', sid, cmd)"
            @pwd-output="(sid, pwd) => emit('pwd-output', sid, pwd)"
            @reconnect="emit('reconnect', $event)"
            @reconnect-all="emit('reconnect-all', $event)"
            @ai-selection="(text, mode) => emit('ai-selection', text, mode)"
            @save-as-snippet="(cmd) => emit('save-as-snippet', cmd)"
          />
        </div>
      </div>

      <div
        v-if="splitHasSecondary"
        class="split-divider"
        :class="{
          horizontal: splitMode === 'horizontal',
          vertical: splitMode === 'vertical',
          resizing: isResizing,
        }"
        :style="getDividerStyle()"
        :title="t('terminal.splitResizeHint')"
        @mousedown="onSplitDividerMousedown"
        @dblclick="emit('reset-split-ratio')"
      >
        <div class="split-divider-handle"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.terminal-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
}

.split-mode-bar {
  height: 30px;
  min-height: 30px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 8px 0 10px;
  background: var(--bg-primary);
  border-bottom: 1px solid var(--border-color);
}

.split-mode-info {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.split-mode-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.split-mode-meta {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-layout-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.layout-action-label {
  font-size: 10px;
  color: var(--text-secondary);
  margin-right: 2px;
}

.terminal-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-height: 0;
}

.split-preview-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
}

.split-preview-zone {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--accent) 18%, transparent);
  border: 2px dashed var(--accent);
  box-sizing: border-box;
  animation: split-preview-pulse 1.2s ease-in-out infinite;
}

.split-preview-overlay.vertical .split-preview-zone.drop-left {
  top: 0; bottom: 0; left: 0; width: 50%;
}
.split-preview-overlay.vertical .split-preview-zone.drop-right {
  top: 0; bottom: 0; right: 0; width: 50%;
}
.split-preview-overlay.horizontal .split-preview-zone.drop-top {
  top: 0; left: 0; right: 0; height: 50%;
}
.split-preview-overlay.horizontal .split-preview-zone.drop-bottom {
  bottom: 0; left: 0; right: 0; height: 50%;
}

.split-preview-zone-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: var(--accent);
}

.split-preview-zone-text {
  font-size: 12px;
  font-weight: 700;
  color: var(--accent);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
}

@keyframes split-preview-pulse {
  0%, 100% { opacity: 0.85; }
  50% { opacity: 0.45; }
}

.terminal-pane {
  position: absolute;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  z-index: 1;
}

.terminal-pane.is-hidden-session {
  /* Keep in DOM for instance reuse; display:none comes from inline style too.
     content-visibility skips layout/paint for off-screen panes without disposing xterm. */
  content-visibility: hidden;
  contain-intrinsic-size: 0 400px;
  pointer-events: none;
  z-index: 0;
}

.terminal-pane-body {
  flex: 1;
  min-width: 0;
  min-height: 0;
  position: relative;
}

.split-pane-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 28px;
  min-height: 28px;
  padding: 0 8px 0 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.split-pane-info {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.split-pane-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.split-session-select {
  max-width: 100px;
  padding: 1px 4px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--accent);
  font-size: 10px;
  font-weight: 600;
  outline: none;
  flex-shrink: 0;
}

.split-pane-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 0;
  max-width: 40%;
}

.split-pane-meta {
  font-size: 11px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.split-divider {
  position: absolute;
  z-index: 5;
  background: transparent;
  display: flex;
  align-items: center;
  justify-content: center;
}

.split-divider.horizontal {
  cursor: row-resize;
}

.split-divider.vertical {
  cursor: col-resize;
}

.split-divider::before {
  content: '';
  position: absolute;
  background: var(--border-color);
  transition: background 0.2s;
}

.split-divider.horizontal::before {
  left: 0;
  right: 0;
  top: 50%;
  height: 2px;
  transform: translateY(-50%);
}

.split-divider.vertical::before {
  top: 0;
  bottom: 0;
  left: 50%;
  width: 2px;
  transform: translateX(-50%);
}

.split-divider:hover::before,
.split-divider.resizing::before {
  background: var(--accent);
}

.split-divider-handle {
  position: relative;
  z-index: 1;
  border-radius: 2px;
  background: transparent;
  transition: background 0.2s, transform 0.2s;
}

.split-divider.horizontal .split-divider-handle {
  width: 40px;
  height: 6px;
}

.split-divider.vertical .split-divider-handle {
  width: 6px;
  height: 40px;
}

.split-divider:hover .split-divider-handle,
.split-divider.resizing .split-divider-handle {
  background: var(--accent);
  opacity: 0.6;
}

.split-divider.resizing .split-divider-handle {
  opacity: 1;
}
</style>
