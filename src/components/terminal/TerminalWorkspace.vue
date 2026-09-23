<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Connection } from '../../env.d'
import type {
  ConnectionGroup,
  Session,
  SplitPaneAddPayload,
  SplitPaneSessionPayload,
  SplitPreviewPayload,
  SplitSwapPayload,
} from '@/domain/session/types'
import type { SplitMode, SplitSide } from '@/domain/terminal/types'
import {
  getSessionSshAddress,
  getTerminalLabel,
} from '@/utils/session/sessionDisplay'
import {
  focusPrimaryTerminalTab,
  type FocusableTerminalTab,
} from '@/utils/terminal/workspaceTerminalFocus'
import AppIcon from '../icons/AppIcon.vue'
import { getSessionPaneStyle as resolveSessionPaneStyle, getDividerStyle as resolveDividerStyle } from '@/utils/terminal/splitPaneLayout'
import { useTerminalSplitKeyboard } from '@/composables/terminal/useTerminalSplitKeyboard'

const TerminalTab = defineAsyncComponent(() => import('./TerminalTab.vue'))
const SubTabBar = defineAsyncComponent(() => import('@/components/workspace/SubTabBar.vue'))

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
    aiApprovalSessions?: Set<string>
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
    /**
     * False when Docker (or other) workspace hides the terminal host via v-show.
     * Keeps TerminalTab/xterm mounted; only freezes foreground paint/resize.
     */
    workspaceVisible?: boolean
    disconnectedSessionIds?: Set<string>
    dockerTabOpen?: boolean
    dockerTabActive?: boolean
  }>(),
  { workspaceVisible: true, dockerTabOpen: false, dockerTabActive: false },
)

const emit = defineEmits<{
  (e: 'select-session', sessionId: string): void
  (e: 'close-session', sessionId: string): void
  (e: 'add-session', connectionId: string): void
  (e: 'session-closed', sessionId: string): void
  (e: 'reconnect', sessionId: string): void
  (e: 'cd-command', sessionId: string, command: string): void
  (e: 'pwd-output', sessionId: string, pwd: string): void
  (e: 'ai-selection', text: string, mode: 'send' | 'insert'): void
  (e: 'save-as-snippet', command: string): void
  (e: 'split-preview', payload: SplitPreviewPayload | null): void
  (e: 'split-commit', payload: { mode: 'horizontal' | 'vertical'; side: SplitSide; sessionId: string }): void
  (e: 'swap-split-panes', payload: SplitSwapPayload): void
  (e: 'close-split'): void
  (e: 'select-split'): void
  (e: 'toggle-horizontal'): void
  (e: 'toggle-vertical'): void
  (e: 'start-split-resize', event: MouseEvent, container: HTMLElement): void
  (e: 'reset-split-ratio'): void
  (e: 'set-secondary-session', sessionId: string): void
  (e: 'bind-terminal-container', el: HTMLElement | null): void
  (e: 'select-split-pane-session', payload: SplitPaneSessionPayload): void
  (e: 'add-split-pane-session', payload: SplitPaneAddPayload): void
  (e: 'close-split-pane-session', payload: SplitPaneSessionPayload): void
  (e: 'select-docker'): void
  (e: 'close-docker'): void
}>()

type TerminalTabExpose = FocusableTerminalTab & { sessionId?: string }

/** sessionId → mounted TerminalTab expose (stable while pane kept alive). */
const terminalTabRefs = new Map<string, TerminalTabExpose>()
const focusedSessionId = ref<string | null>(null)
const maximizedSessionId = ref<string | null>(null)

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

function focusActiveTerminal(): boolean {
  const focusedId = focusedSessionId.value
  if (focusedId && isSessionVisible(focusedId)) {
    const focused = terminalTabRefs.get(focusedId)
    if (focused?.focusTerminal()) return true
  }
  return focusPrimaryTerminalTab(
    terminalTabRefs,
    props.activeSession?.id ?? null,
    props.liveSessionIds,
  )
}

defineExpose({
  focusActiveTerminal,
})

const terminalContainerRef = ref<HTMLElement | null>(null)

const secondarySession = computed(() => {
  if (!props.activeSession || props.allSessions.length < 2) return null
  const activeId = props.activeSession.id
  if (props.secondarySessionId) {
    const picked = props.allSessions.find(
      (s) => s.id === props.secondarySessionId && s.id !== activeId,
    )
    if (picked) return picked
    // Dragged the active tab: treat that tab as secondary by switching primary
    // is handled at commit time; here fall through to auto-pick.
  }
  return props.allSessions.find((s) => s.id !== activeId) || null
})

const secondaryCandidates = computed(() => {
  if (!props.activeSession) return []
  return props.activeGroup?.sessions.filter((s) => s.id !== props.activeSession!.id) ?? []
})

const splitHasSecondary = computed(() => props.isSplit && !!secondarySession.value)
const crossHostSplit = computed(
  () => splitHasSecondary.value && !!props.activeSession && !!secondarySession.value &&
    props.activeSession.connectionId !== secondarySession.value.connectionId,
)
const canUseLayoutButtons = computed(
  () => splitHasSecondary.value || (props.activeGroup?.sessions.length ?? 0) >= 2,
)

const previewSessionLabel = computed(() => {
  const session = props.allSessions.find((item) => item.id === props.previewSessionId)
  return session ? sessionOptionLabel(session) : ''
})

watch(
  [
    splitHasSecondary,
    () => props.activeSession?.id ?? null,
    () => secondarySession.value?.id ?? null,
  ],
  ([isSplitNow, primaryId, secondaryId]) => {
    if (!isSplitNow) {
      focusedSessionId.value = primaryId
      maximizedSessionId.value = null
      return
    }
    if (focusedSessionId.value !== primaryId && focusedSessionId.value !== secondaryId) {
      focusedSessionId.value = primaryId
    }
    if (maximizedSessionId.value !== primaryId && maximizedSessionId.value !== secondaryId) {
      maximizedSessionId.value = null
    }
  },
  { immediate: true },
)

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

function sessionUser(session: Session | null | undefined): string {
  const address = sessionSshAddress(session)
  const at = address.indexOf('@')
  return at > 0 ? address.slice(0, at) : ''
}

function sessionOptionLabel(session: Session): string {
  const terminal = getTerminalLabel(session)
  if (!props.activeSession || session.connectionId === props.activeSession.connectionId) return terminal
  return `${session.connectionName} / ${terminal}`
}

function paneSessions(session: Session): Session[] {
  return props.allSessions.filter((item) => item.connectionId === session.connectionId)
}

function splitPaneSide(sessionId: string): 'primary' | 'secondary' {
  return isSecondarySession(sessionId) ? 'secondary' : 'primary'
}

function selectSplitPaneTerminal(currentSession: Session, nextSession: Session) {
  if (currentSession.id === nextSession.id) return
  focusedSessionId.value = nextSession.id
  emit('select-split-pane-session', {
    side: splitPaneSide(currentSession.id),
    sessionId: nextSession.id,
  })
}

function addSplitPaneTerminal(session: Session) {
  emit('add-split-pane-session', {
    side: splitPaneSide(session.id),
    connectionId: session.connectionId,
  })
}

function closeSplitPaneTerminal(session: Session) {
  emit('close-split-pane-session', {
    side: splitPaneSide(session.id),
    sessionId: session.id,
  })
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

function focusPane(sessionId: string, focusTerminal = true) {
  if (!isSessionVisible(sessionId)) return
  focusedSessionId.value = sessionId
  if (focusTerminal) {
    void nextTick(() => terminalTabRefs.get(sessionId)?.focusTerminal())
  }
}

function onPanePointerDown(event: MouseEvent, sessionId: string) {
  focusedSessionId.value = sessionId
  const target = event.target as HTMLElement | null
  if (!target?.closest('button, select, input, textarea, [contenteditable="true"]')) {
    focusPane(sessionId)
  }
}

function togglePaneMaximize(sessionId: string) {
  maximizedSessionId.value = maximizedSessionId.value === sessionId ? null : sessionId
  focusPane(sessionId)
}

function swapSplitPanes() {
  if (!props.activeSession || !secondarySession.value) return
  emit('swap-split-panes', {
    primarySessionId: props.activeSession.id,
    secondarySessionId: secondarySession.value.id,
  })
}

function closeSplit() {
  maximizedSessionId.value = null
  emit('close-split')
  if (props.activeSession) focusPane(props.activeSession.id)
}

useTerminalSplitKeyboard({
  workspaceVisible: () => props.workspaceVisible !== false,
  dockerTabActive: () => !!props.dockerTabActive,
  container: () => terminalContainerRef.value,
  canUseLayoutButtons: () => canUseLayoutButtons.value,
  isSplit: () => props.isSplit,
  splitMode: () => props.splitMode,
  splitHasSecondary: () => splitHasSecondary.value,
  primarySessionId: () => props.activeSession?.id ?? null,
  secondarySessionId: () => secondarySession.value?.id ?? null,
  secondarySide: () => props.secondarySide,
  toggleVertical: () => emit('toggle-vertical'),
  toggleHorizontal: () => emit('toggle-horizontal'),
  clearMaximize: () => { maximizedSessionId.value = null },
  focusSession: (sessionId) => focusPane(sessionId),
})

onMounted(() => {
  void nextTick(() => emit('bind-terminal-container', terminalContainerRef.value))
})
onBeforeUnmount(() => {
  emit('bind-terminal-container', null)
})

function splitPaneLayoutState() {
  return {
    dividerSize: props.dividerSize,
    splitRatio: props.splitRatio,
    splitMode: props.splitMode,
    secondarySide: props.secondarySide,
    splitHasSecondary: splitHasSecondary.value,
    maximizedSessionId: maximizedSessionId.value,
    primarySessionId: props.activeSession?.id ?? null,
    secondarySessionId: secondarySession.value?.id ?? null,
  }
}

function getSessionPaneStyle(sessionId: string): Record<string, string> {
  return resolveSessionPaneStyle(sessionId, splitPaneLayoutState())
}

function getDividerStyle(): Record<string, string> {
  return resolveDividerStyle(splitPaneLayoutState())
}

function onSplitDividerMousedown(e: MouseEvent) {
  if (terminalContainerRef.value) {
    emit('start-split-resize', e, terminalContainerRef.value)
  }
}

</script>

<template>
  <div class="terminal-section">
    <SubTabBar
      v-if="activeGroup && activeGroup.sessions.length > 0 && !crossHostSplit"
      :sessions="activeGroup.sessions"
      :active-session-id="activeGroup.activeSessionId"
      :connection-id="activeGroup.connectionId"
      :unread-sessions="unreadSessions"
      :ai-approval-sessions="aiApprovalSessions"
      :disconnected-session-ids="disconnectedSessionIds"
      :terminal-container="terminalContainerRef"
      :docker-tab-open="dockerTabOpen"
      :docker-tab-active="dockerTabActive"
      :split-mode="splitMode"
      :split-primary-session-id="crossHostSplit ? null : splitPrimarySessionId"
      :split-secondary-session-id="crossHostSplit ? null : secondarySessionId"
      :split-group-active="isSplit && !crossHostSplit"
      @select="emit('select-session', $event)"
      @close="emit('close-session', $event)"
      @add="emit('add-session', $event)"
      @select-docker="emit('select-docker')"
      @close-docker="emit('close-docker')"
      @split-preview="emit('split-preview', $event)"
      @split-commit="emit('split-commit', $event)"
      @select-split="emit('select-split')"
      @close-split="closeSplit"
    >
      <template v-if="!dockerTabActive" #actions>
        <div class="terminal-layout-actions">
          <template v-if="splitHasSecondary">
            <button
              class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
              type="button"
              :title="t('terminal.swapPanes')"
              :aria-label="t('terminal.swapPanes')"
              @click="swapSplitPanes"
            >
              <AppIcon name="swap" size="sm" />
            </button>
            <button
              class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
              type="button"
              :title="t('terminal.exitSplit')"
              :aria-label="t('terminal.exitSplit')"
              @click="closeSplit"
            >
              <AppIcon name="split-exit" size="sm" />
            </button>
            <span class="terminal-layout-separator"></span>
          </template>
          <button
            class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
            type="button"
            :class="{ active: isSplit && splitMode === 'horizontal' }"
            :title="canUseLayoutButtons
              ? t('terminal.splitHorizontalShortcut')
              : t('terminal.splitNeedsSecondTerminal')"
            :disabled="!canUseLayoutButtons"
            @click="emit('toggle-horizontal')"
          >
            <AppIcon name="split-h" size="sm" />
          </button>
          <button
            class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
            type="button"
            :class="{ active: isSplit && splitMode === 'vertical' }"
            :title="canUseLayoutButtons
              ? t('terminal.splitVerticalShortcut')
              : t('terminal.splitNeedsSecondTerminal')"
            :disabled="!canUseLayoutButtons"
            @click="emit('toggle-vertical')"
          >
            <AppIcon name="split-v" size="sm" />
          </button>
        </div>
      </template>
    </SubTabBar>

    <div
      v-show="!dockerTabActive"
      ref="terminalContainerRef"
      class="terminal-container"
      :class="{
        'is-split': splitHasSecondary,
        'split-horizontal': splitHasSecondary && splitMode === 'horizontal',
        'split-vertical': splitHasSecondary && splitMode === 'vertical',
      }"
    >
      <div v-if="previewActive" class="split-preview-overlay">
        <div
          v-for="target in [
            { side: 'left', label: t('terminal.sideLeft'), icon: 'split-v' },
            { side: 'right', label: t('terminal.sideRight'), icon: 'split-v' },
            { side: 'top', label: t('terminal.sideTop'), icon: 'split-h' },
            { side: 'bottom', label: t('terminal.sideBottom'), icon: 'split-h' },
          ]"
          :key="target.side"
          class="split-preview-zone"
          :class="[`drop-${target.side}`, { 'is-active': previewSide === target.side }]"
        >
          <AppIcon :name="target.icon as 'split-h' | 'split-v'" size="lg" />
          <span>{{ target.label }}</span>
        </div>
        <div class="split-preview-cancel" :class="{ 'is-active': previewMode === 'none' }">
          <AppIcon name="close" size="md" />
          <span>{{ t('terminal.splitDropCancel') }}</span>
        </div>
        <div v-if="previewSessionLabel" class="split-preview-session">
          {{ t('terminal.splitDragging', { label: previewSessionLabel }) }}
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
          'is-focused': splitHasSecondary && focusedSessionId === session.id,
          'is-maximized': maximizedSessionId === session.id,
          'is-hidden-session': !isSessionVisible(session.id),
        }"
        :style="getSessionPaneStyle(session.id)"
        @mousedown="onPanePointerDown($event, session.id)"
      >
        <div
          v-if="splitHasSecondary && isSessionVisible(session.id)"
          class="split-pane-header"
          :title="sessionSshAddress(session) || session.connectionName"
        >
          <div class="split-pane-info">
            <template v-if="crossHostSplit">
              <span class="split-pane-host">{{ session.connectionName }}</span>
              <div class="split-pane-tabs" role="tablist" :aria-label="session.connectionName">
                <button
                  v-for="paneSession in paneSessions(session)"
                  :key="paneSession.id"
                  type="button"
                  class="split-pane-tab"
                  :class="{ active: paneSession.id === session.id }"
                  :aria-selected="paneSession.id === session.id"
                  role="tab"
                  @click.stop="selectSplitPaneTerminal(session, paneSession)"
                >
                  {{ getTerminalLabel(paneSession) }}
                </button>
                <button
                  type="button"
                  class="split-pane-tab-add"
                  :title="t('terminal.newTerminal')"
                  :aria-label="t('terminal.newTerminal')"
                  @click.stop="addSplitPaneTerminal(session)"
                >
                  <AppIcon name="plus" size="xs" />
                </button>
              </div>
            </template>
            <template v-else>
              <select
                v-if="isSecondarySession(session.id) && secondaryCandidates.length > 1"
                class="ui-select ui-input-sm split-session-select"
                :value="session.id"
                :title="t('terminal.switchSplitSession')"
                :aria-label="t('terminal.switchSplitSession')"
                @change="emit('set-secondary-session', ($event.target as HTMLSelectElement).value)"
              >
                <option v-for="s in secondaryCandidates" :key="s.id" :value="s.id">
                  {{ sessionOptionLabel(s) }}
                </option>
              </select>
              <span v-else class="split-pane-tag">{{ getTerminalLabel(session) }}</span>
            </template>
            <span v-if="sessionUser(session)" class="split-pane-user">{{ sessionUser(session) }}</span>
          </div>
          <div class="split-pane-actions">
            <template v-if="crossHostSplit && isPrimarySession(session.id)">
              <button
                class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
                type="button"
                :title="t('terminal.swapPanes')"
                :aria-label="t('terminal.swapPanes')"
                @click="swapSplitPanes"
              >
                <AppIcon name="swap" size="xs" />
              </button>
              <button
                class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
                type="button"
                :class="{ active: splitMode === 'horizontal' }"
                :title="t('terminal.splitHorizontalShortcut')"
                @click="emit('toggle-horizontal')"
              >
                <AppIcon name="split-h" size="xs" />
              </button>
              <button
                class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
                type="button"
                :class="{ active: splitMode === 'vertical' }"
                :title="t('terminal.splitVerticalShortcut')"
                @click="emit('toggle-vertical')"
              >
                <AppIcon name="split-v" size="xs" />
              </button>
            </template>
            <button
              class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
              type="button"
              :title="maximizedSessionId === session.id ? t('terminal.restorePane') : t('terminal.maximizePane')"
              :aria-label="maximizedSessionId === session.id ? t('terminal.restorePane') : t('terminal.maximizePane')"
              @click="togglePaneMaximize(session.id)"
            >
              <AppIcon :name="maximizedSessionId === session.id ? 'restore' : 'maximize'" size="xs" />
            </button>
            <button
              class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close"
              type="button"
              :title="t('terminal.closeSession', { label: getTerminalLabel(session) })"
              :aria-label="t('terminal.closeSession', { label: getTerminalLabel(session) })"
              @click="crossHostSplit
                ? closeSplitPaneTerminal(session)
                : emit('close-session', session.id)"
            >
              <AppIcon name="close" size="xs" />
            </button>
          </div>
        </div>
        <div class="terminal-pane-body">
          <TerminalTab
            :ref="(el) => bindTerminalTabRef(session.id, el)"
            :session-id="session.id"
            :connection-name="session.connectionName"
            :connection-id="session.connectionId"
            :start-disconnected="session.pending === true"
            :active="isSessionVisible(session.id)"
            :workspace-visible="workspaceVisible !== false"
            @closed="emit('session-closed', $event)"
            @cd-command="(sid, cmd) => emit('cd-command', sid, cmd)"
            @pwd-output="(sid, pwd) => emit('pwd-output', sid, pwd)"
            @reconnect="emit('reconnect', $event)"
            @ai-selection="(text, mode) => emit('ai-selection', text, mode)"
            @save-as-snippet="(cmd) => emit('save-as-snippet', cmd)"
          />
        </div>
      </div>

      <div
        v-if="splitHasSecondary && !maximizedSessionId"
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

    <div v-show="dockerTabActive" class="docker-pane-host">
      <slot name="docker-pane" />
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

.terminal-layout-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.terminal-layout-separator {
  width: 1px;
  height: 14px;
  margin: 0 3px;
  background: var(--border-color);
}

.terminal-container {
  flex: 1;
  position: relative;
  overflow: hidden;
  min-height: 0;
}

.docker-pane-host {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.docker-pane-host > :deep(.docker-workspace) {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.split-preview-overlay {
  position: absolute;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  background: color-mix(in srgb, var(--bg-primary) 54%, transparent);
}

.split-preview-zone {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-secondary) 86%, transparent);
  border: 1px dashed var(--border-color);
  box-sizing: border-box;
  font-size: 11px;
  font-weight: 600;
  transition: color 0.12s, background 0.12s, border-color 0.12s;
}

.split-preview-zone.drop-left {
  top: 30%; bottom: 30%; left: 8px; width: 22%;
}
.split-preview-zone.drop-right {
  top: 30%; bottom: 30%; right: 8px; width: 22%;
}
.split-preview-zone.drop-top {
  top: 8px; left: 30%; right: 30%; height: 22%;
}
.split-preview-zone.drop-bottom {
  bottom: 8px; left: 30%; right: 30%; height: 22%;
}

.split-preview-zone.is-active,
.split-preview-cancel.is-active {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 20%, var(--bg-primary));
  border-color: var(--accent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 45%, transparent);
}

.split-preview-cancel {
  position: absolute;
  inset: 32%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: var(--text-secondary);
  background: color-mix(in srgb, var(--bg-secondary) 92%, transparent);
  border: 1px dashed var(--border-color);
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
}

.split-preview-session {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  padding: 4px 8px;
  border-radius: 999px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-size: 11px;
  white-space: nowrap;
}

.terminal-pane {
  position: absolute;
  overflow: hidden;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  z-index: 1;
  transition: box-shadow 0.12s;
}

.terminal-pane.is-focused {
  box-shadow: inset 0 2px 0 var(--accent);
}

.terminal-pane.is-maximized {
  z-index: 4;
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
  gap: 6px;
  height: 26px;
  min-height: 26px;
  padding: 0 5px 0 8px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.terminal-pane.is-focused .split-pane-header {
  background: color-mix(in srgb, var(--accent) 6%, var(--bg-secondary));
}

.split-pane-info {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.split-pane-host {
  max-width: 128px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}

.split-pane-tabs {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow: hidden;
}

.split-pane-tab,
.split-pane-tab-add {
  height: 20px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 10px;
  line-height: 20px;
  cursor: pointer;
  white-space: nowrap;
}

.split-pane-tab {
  padding: 0 6px;
}

.split-pane-tab:hover,
.split-pane-tab-add:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.split-pane-tab.active {
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
}

.split-pane-tab-add {
  width: 20px;
  min-width: 20px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border-color);
}

.split-pane-tag {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  height: 20px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  flex-shrink: 0;
}

.split-session-select {
  width: auto;
  max-width: 180px;
  height: 22px;
  min-height: 22px;
  padding: 0 22px 0 6px;
  font-size: 10px;
  font-weight: 600;
  line-height: 20px;
  color: var(--accent);
  flex-shrink: 0;
  background-position: right 6px center;
  background-size: 10px;
}

.split-pane-user {
  font-size: 11px;
  line-height: 20px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.split-pane-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  opacity: 0.48;
  transition: opacity 0.12s;
}

.terminal-pane:hover .split-pane-actions,
.terminal-pane.is-focused .split-pane-actions {
  opacity: 1;
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
