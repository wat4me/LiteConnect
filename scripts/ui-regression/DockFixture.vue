<script setup lang="ts">
import { computed, nextTick, onMounted, provide, reactive, ref } from 'vue'
import SshWorkspace from '../../src/components/workspace/SshWorkspace.vue'
import AppDialogHost from '../../src/components/app/AppDialogHost.vue'
import { useWorkspaceLayout } from '../../src/composables/workspace/useWorkspaceLayout'
import { useWorkspacePanelPolicy } from '../../src/composables/workspace/useWorkspacePanelPolicy'
import { useTerminalPwd } from '../../src/composables/terminal/useTerminalPwd'
import { useSplitTerminal } from '../../src/composables/terminal/useSplitTerminal'
import { useWorkspaceSplitController } from '../../src/composables/terminal/useWorkspaceSplitController'
import type { SplitDropPayload, SplitSwapPayload } from '../../src/domain/session/types'
import type { SplitMode } from '../../src/domain/terminal/types'
import { useTheme } from '../../src/composables/app/useTheme'
import { setAppLocale } from '../../src/i18n'
import { WORKSPACE_TOOLS, type WorkspacePanel, type WorkspaceTool } from '../../shared/workspaceLayout'
import type { AppSettingsChange } from '../../shared/types/settings'
import type { AiChatResult, AiSessionStore, AiSettings } from '../../shared/types/ai'
import type { ConnectionGroup, Session } from '../../src/domain/session/types'
import type { Connection } from '../../shared/types/connection'

const backend = (window as any).__dockBackend
const callbacks = new Map<string, Set<(...args: any[]) => void>>()
const calls = { resizes: [] as unknown[], writes: [] as unknown[], fileLoads: [] as string[], cwdChecks: [] as string[], dataSubscriptions: 0, unknown: [] as string[] }
let echoCwdInput = false
function listen(name: string, fn: (...args: any[]) => void) {
  const set = callbacks.get(name) || new Set(); set.add(fn); callbacks.set(name, set)
  return () => set.delete(fn)
}
const stores = new Map<string, AiSessionStore>()
const rendererState = new Map<string, unknown>()
const settings: AiSettings = { providers: [{ id: 'fixture', name: 'Fixture', baseUrl: 'https://example.test/v1', apiKey: 'fixture-only', models: [{ id: 'fixture-model' }] }], activeProviderId: 'fixture', activeModel: 'fixture-model', systemPrompt: '' }
let finishAiReply: ((reply: AiChatResult) => void) | undefined
const api = {
  getAllSettings: () => backend.invoke('get'), setManySettings: (patch: unknown) => backend.invoke('set', patch),
  onSettingsChanged: (fn: (change: AppSettingsChange) => void) => backend.settings(fn),
  getAiSettings: async () => structuredClone(settings), getAiSessionStore: async (id: string) => stores.get(id) || { version: 1, activeThreadId: 'initial', defaultContextFiles: [], threads: [{ id: 'initial', title: '', createdAt: 1, updatedAt: 1, contextFiles: [], messages: [] }] },
  aiCreateConversation: async (id: string) => {
    const store: AiSessionStore = { version: 1, activeThreadId: `draft-${stores.size}`, defaultContextFiles: [], threads: [{ id: `draft-${stores.size}`, title: '', createdAt: 1, updatedAt: 1, contextFiles: [], messages: [] }] }
    stores.set(id, store); return store
  },
  setAiSessionStore: async (id: string, store: AiSessionStore) => { stores.set(id, store) },
  setAiSettings: async (next: AiSettings) => { Object.assign(settings, next) },
  appendAiSessionHistory: async () => {},
  aiChatStream: () => new Promise<AiChatResult>(resolve => { finishAiReply = resolve }),
  aiKnowledge: async () => ({ storagePath: '/fixture/knowledge.sqlite', targets: [], groups: [] }),
  aiListExecutions: async () => [], listAiModels: async () => [],
  mcpListJobs: async () => [], onMcpJobsChanged: (fn: () => void) => listen('jobs', fn),
  onAiChatStream: (fn: () => void) => listen('ai', fn), onAiBackgroundReply: (fn: () => void) => listen('background', fn),
  getTerminalFontSize: async () => 14, getTerminalFontFamily: async () => 'Consolas, monospace', getTerminalPalette: async () => 'auto', getTerminalScrollback: async () => 5000,
  getTerminalPasteConfirmEnabled: async () => true, getTerminalPasteConfirmMaxChars: async () => 500, getTerminalCommandSuggestEnabled: async () => false,
  getAutoReconnectEnabled: async () => false, getAutoReconnectMaxRetries: async () => 5, onRuntimeSettingsChanged: (fn: () => void) => listen('runtime', fn),
  sshResize: (...args: unknown[]) => calls.resizes.push(args), sshSetOutputPaused: () => {},
  sshWrite: (id: string, data: string) => {
    calls.writes.push([id, data])
    if (echoCwdInput) callbacks.get(`data:${id}`)?.forEach(fn => fn(data === '\r' ? '\r\nops@production:~$ ' : data))
  },
  sshTakeStartupNotices: async () => [],
  onSshData: (id: string, fn: (text: string) => void) => { calls.dataSubscriptions++; queueMicrotask(() => fn('\x1b[32mops@production\x1b[0m:~$ echo "Workspace layout preview"\r\nWorkspace layout preview\r\nops@production:~$ ')); return listen(`data:${id}`, fn) },
  onSshClosed: (id: string, fn: () => void) => listen(`closed:${id}`, fn), onSshError: (id: string, fn: () => void) => listen(`error:${id}`, fn), onSshReconnected: (id: string, fn: () => void) => listen(`reconnected:${id}`, fn),
  sftpInit: async () => '/home/ops', sftpExecHome: async () => '/home/ops', sftpRealpath: async (_id: string, path: string) => path,
  sftpExists: async (_id: string, path: string, directoryOnly?: boolean) => {
    if (directoryOnly) calls.cwdChecks.push(path)
    return !echoCwdInput || ['/home/ops', '/home', '/home/v5-automation-servers'].includes(path)
  },
  sftpReaddir: async (_id: string, path: string) => { calls.fileLoads.push(path); return ['app', 'logs', 'config'].map(name => ({ name, path: `${path}/${name}`, isDirectory: true, isSymlink: false, size: 0, modifyTime: 1, permissions: 'drwxr-xr-x' })) },
  getRendererState: async (key: string) => rendererState.get(key), setRendererState: async (key: string, value: unknown) => { rendererState.set(key, value) },
  onSftpPathBookmarksChanged: (fn: () => void) => listen('bookmarks', fn),
  getDownloadConflictStrategy: async () => 'rename', getCommandSnippets: async () => [],
  setCommandSnippets: async () => {}, clipboardWriteText: async () => {},
  onTransferStart: (fn: () => void) => listen('transfer-start', fn), onTransferProgress: (fn: () => void) => listen('transfer-progress', fn), onTransferComplete: (fn: () => void) => listen('transfer-complete', fn), onTransferError: (fn: () => void) => listen('transfer-error', fn), onUploadConflict: (fn: () => void) => listen('upload-conflict', fn),
  getAppInfo: async () => ({ platform: 'win32-x64' }),
  monitorStart: async () => {}, monitorStop: async () => {}, onMonitorData: (_id: string, fn: () => void) => listen('monitor', fn),
  monitorGetAlertRule: async () => ({ enabled: false, backgroundEnabled: false, cpuThreshold: 90, memoryThreshold: 90, maxNotificationsPer24h: 5 }),
}
;(window as any).LiteConnect = new Proxy(api, { get(target, key) {
  if (key in target) return target[key as keyof typeof target]
  calls.unknown.push(String(key)); return undefined
} })
const preferences = useWorkspaceLayout(), narrow = ref(false)
const panels = { ai: ref(false), files: ref(false), monitor: ref(false), batch: ref(false), snippets: ref(false), sync: ref(false) }
useWorkspacePanelPolicy(preferences.layout, panels, narrow)
const visible = computed(() => Object.fromEntries(Object.entries(panels).map(([id, value]) => [id, value.value])))
const pwd = useTerminalPwd({ isDirectory: (id, path) => api.sftpExists(id, path, true) })
provide('pwdTracker', pwd)
const theme = useTheme()
provide('theme', theme.theme); provide('customColors', theme.customColors)
const sessions: Session[] = ['one', 'two'].map((id, i) => ({ id, connectionId: 'production', connectionName: 'Production', tabNumber: i + 1 }))
const production = reactive<ConnectionGroup>({ connectionId: 'production', connectionName: 'Production', sessions, activeSessionId: 'one', nextTabNumber: 3 })
const staging = reactive<ConnectionGroup>({ connectionId: 'staging', connectionName: 'Staging', sessions: [{ id: 'three', connectionId: 'staging', connectionName: 'Staging', tabNumber: 1 }], activeSessionId: 'three', nextTabNumber: 2 })
const group = ref(production)
const allSessions = computed(() => [...production.sessions, ...staging.sessions])
const current = computed(() => group.value.sessions.find(session => session.id === group.value.activeSessionId)!)
const connection: Connection = { id: 'production', name: 'Production', host: 'production.test', port: 22, username: 'ops', password: '', group: '', createdAt: 1, updatedAt: 1 }
const connections = [connection, { ...connection, id: 'staging', name: 'Staging', host: 'staging.test' }]
const batchTargets = sessions.map(session => ({ ...session, terminalLabel: String(session.tabNumber), displayName: `Production / ${session.tabNumber}`, sshAddress: 'ops@production.test:22', host: 'production.test', port: 22, user: 'ops' }))
const docker = ref(false)
const { isSplit: split, splitMode, splitRatio, isResizing, splitPrimarySessionId, secondarySessionId, secondarySide, previewMode, previewActive, previewSide, previewSessionId,
  setSplitMode, setSplitPrimarySessionId, setSecondarySessionId, setSplitPreview, closeSplit, suspendSplit, restoreSplit, toggleHorizontal, toggleVertical, startSplitResize, resetSplitRatio } = useSplitTerminal()
function getGroupBySessionId(id: string) { return [production, staging].find(item => item.sessions.some(session => session.id === id)) || null }
function selectSession(id: string) { const next = getGroupBySessionId(id); if (next) { group.value = next; next.activeSessionId = id } }
const splitController = useWorkspaceSplitController({ isSplit: split, activeSessionId: computed(() => current.value.id), primarySessionId: splitPrimarySessionId, secondarySessionId,
  getGroupBySessionId, createSession: async () => null, closeSession: async () => {}, setSidebarTarget: () => {}, setPrimarySessionId: setSplitPrimarySessionId, setSecondarySessionId, closeSplit, suspendSplit, restoreSplit })
function commitSplit(payload: SplitDropPayload) {
  const primaryId = payload.primarySessionId || (payload.sessionId === current.value.id ? group.value.sessions.find(session => session.id !== payload.sessionId)?.id : current.value.id)
  if (!primaryId) return
  selectSession(primaryId); setSecondarySessionId(payload.sessionId); setSplitMode(payload.mode, payload.side, primaryId)
}
function swapSplit(payload: SplitSwapPayload) { selectSession(payload.secondarySessionId); setSplitPrimarySessionId(payload.secondarySessionId); setSecondarySessionId(payload.primarySessionId) }
const sidebar = ref<any>()
function toggle(id: WorkspaceTool) { if (id === 'docker') docker.value = !docker.value; else panels[id].value = !panels[id].value }
onMounted(() => {
  ;(window as any).__dock = {
    calls, snapshot: () => ({ layout: JSON.parse(JSON.stringify(preferences.layout.value)), panels: visible.value, ready: preferences.ready.value, saving: preferences.saving.value, error: preferences.error.value, narrow: narrow.value, split: split.value, splitMode: splitMode.value, splitRatio: splitRatio.value, primary: splitPrimarySessionId.value, secondary: secondarySessionId.value }),
    async theme(value: 'light' | 'dark' | 'eyecare', locale: 'zh-CN' | 'en-US') { theme.setTheme(value); setAppLocale(locale); await nextTick() },
    async split(value: boolean, mode: Exclude<SplitMode, 'none'> = 'horizontal', crossHost = false) { if (value) commitSplit({ sessionId: crossHost ? 'three' : 'two', mode, side: mode === 'horizontal' ? 'bottom' : 'right' }); else closeSplit(); await nextTick() },
    async session(id: string) { selectSession(id); await nextTick() },
    async reset() { preferences.update({ ...preferences.layout.value, locked: false }); await nextTick() },
    tools: WORKSPACE_TOOLS,
    enableCwdInputEcho() { echoCwdInput = true },
    finishAiReply() { finishAiReply?.({ content: 'Done' }); finishAiReply = undefined },
  }
})
</script>

<template>
  <div class="dock-fixture">
    <div class="dock-fixture-titlebar">LiteConnect · SSH</div>
    <SshWorkspace :layout="preferences.layout.value" :layout-ready="preferences.ready.value" :layout-error="preferences.error.value" :layout-saving="preferences.saving.value" :sync-input-open="panels.sync.value"
      :active-group="group" :active-session="current" :active-session-id="current.id" :all-sessions="allSessions" :live-session-ids="allSessions.map(session => session.id)" :connections="connections" :unread-sessions="new Set()" :show-ai-unread="false"
      :ai-sidebar-visible="panels.ai.value" :sidebar-visible="panels.files.value" :sidebar-session-id="current.id" :ai-selection-request="null"
      :monitor-visible="panels.monitor.value" :batch-panel-visible="panels.batch.value" :snippets-panel-visible="panels.snippets.value" :batch-sessions="batchTargets" batch-initial-command=""
      :split-mode="splitMode" :split-ratio="splitRatio" :is-split="split" :is-resizing="isResizing" :preview-mode="previewMode" :preview-active="previewActive" :preview-side="previewSide" :preview-session-id="previewSessionId" :divider-size="6" :split-primary-session-id="splitPrimarySessionId" :secondary-session-id="secondarySessionId" :secondary-side="secondarySide" :docker-mode="docker"
      @layout-change="preferences.update" @layout-retry="preferences.retry" @single-panel-mode="narrow = $event"
      @toggle-ai="toggle('ai')" @toggle-files="toggle('files')" @toggle-monitor="toggle('monitor')" @toggle-batch="toggle('batch')" @toggle-snippets="toggle('snippets')" @toggle-sync="toggle('sync')" @toggle-docker="toggle('docker')"
      @close-ai="panels.ai.value = false" @close-files="panels.files.value = false" @close-monitor="panels.monitor.value = false" @close-batch="panels.batch.value = false" @close-snippets="panels.snippets.value = false" @close-sync="panels.sync.value = false"
      @bind-file-sidebar="sidebar = $event" @select-session="selectSession"
      @cd-command="pwd.handleCd" @pwd-output="pwd.setPwd"
      @toggle-horizontal="toggleHorizontal(current.id, secondarySessionId || group.sessions.find(session => session.id !== current.id)?.id)"
      @toggle-vertical="toggleVertical(current.id, secondarySessionId || group.sessions.find(session => session.id !== current.id)?.id)"
      @split-preview="setSplitPreview" @split-commit="commitSplit" @swap-split-panes="swapSplit" @close-split="closeSplit" @select-split="restoreSplit"
      @start-split-resize="startSplitResize" @reset-split-ratio="resetSplitRatio"
      @select-split-pane-session="splitController.selectSplitPaneSession" />
    <AppDialogHost />
  </div>
</template>

<style scoped>
.dock-fixture { height: 100%; display: flex; flex-direction: column; color: var(--text-primary); background: var(--bg-primary); }
.dock-fixture-titlebar { height: 36px; flex-shrink: 0; display: flex; align-items: center; padding: 0 14px; border-bottom: 1px solid var(--border-color); background: var(--bg-secondary); font-size: 12px; -webkit-app-region: drag; }
</style>
