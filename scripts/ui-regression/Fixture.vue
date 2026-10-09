<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import ConnectionsView from '../../src/views/ConnectionsView.vue'
import SftpBookmarkMenu from '../../src/components/sftp/SftpBookmarkMenu.vue'
import InlineLabel from '../../src/components/common/InlineLabel.vue'
import AiChatView from '../../src/components/ai/AiChatView.vue'
import AiSidebar from '../../src/components/ai/AiSidebar.vue'
import { useAiChat } from '../../src/composables/ai/useAiChat'
import type { AiSessionStore, AiSettings } from '../../shared/types/ai'
import FileEditorModal from '../../src/components/sftp/FileEditorModal.vue'
import DirectorySyncModal from '../../src/components/sftp/DirectorySyncModal.vue'
import SftpToolbar from '../../src/components/sftp/SftpToolbar.vue'
import AppDialogHost from '../../src/components/app/AppDialogHost.vue'
import type { ChatItem } from '../../src/composables/ai/useAiChat'
import type { AiActivityPhase } from '../../src/utils/ai/chatActivity'
import type { Connection, Group } from '../../shared/types/connection'
import type { SftpPathBookmark } from '../../shared/types/sftp'

const groups: Group[] = [
  { id: 'dev', name: '默认分组', order: 0, isDefault: true },
  { id: 'prod', name: '生产环境 Production', order: 1, isDefault: false },
]
let connections: Connection[] = [
  { id: 'one', name: '服务器一 Server one', group: 'dev', host: 'dev.example.test', port: 22, username: 'tester', password: '', colorTag: 'orange', createdAt: 1, updatedAt: 1 },
  { id: 'two', name: '服务器二 Server two', group: 'prod', host: 'prod.example.test', port: 22, username: 'tester', password: '', createdAt: 2, updatedAt: 2 },
]
const initialData = { groups, connections }
const calls = { connects: [] as string[], moves: [] as string[], reorders: 0, editorSaves: [] as any[], uploads: [] as any[], sftpActions: [] as string[], aiRequests: [] as any[], aiCreates: [] as string[] }
const imageSettings: AiSettings = { providers: [{ id: 'fixture', name: '测试接口', baseUrl: 'https://example.test/v1', apiKey: 'fixture-only', models: [{ id: 'vision-fixture', supportsImages: true }] }], activeProviderId: 'fixture', activeModel: 'vision-fixture', systemPrompt: '' }
let imageHistory: AiSessionStore = { version: 1, activeThreadId: 'image-thread', defaultContextFiles: [], threads: [{ id: 'image-thread', title: '', createdAt: 1, updatedAt: 1, contextFiles: [], messages: [] }] }
const otherImageHistory: AiSessionStore = { version: 1, activeThreadId: 'other-thread', defaultContextFiles: [], threads: [{ id: 'other-thread', title: '', createdAt: 1, updatedAt: 1, contextFiles: [], messages: [] }] }
let remoteContent = 'original content'
let remoteRevision = 'a'.repeat(64)
let previewFails = false
// This test window has no production preload, credentials, SSH or disk writes.
;(window as any).LiteConnect = {
  getAiSettings: async () => JSON.parse(JSON.stringify(imageSettings)),
  listAiModels: async () => [{ id: 'vision-fixture', contextWindowTokens: 64000 }],
  getAiSessionStore: async (id: string) => JSON.parse(JSON.stringify(id === 'image-fixture' ? imageHistory : otherImageHistory)),
  setAiSessionStore: async (_id: string, store: AiSessionStore) => { imageHistory = store },
  appendAiSessionHistory: async (_id: string, record: any) => { imageHistory.threads.find(thread => thread.id === imageHistory.activeThreadId)!.messages.push(record) },
  aiCreateConversation: async (_id: string, payload: any) => {
    calls.aiCreates.push(_id)
    const previous = imageHistory.threads.find(thread => thread.id === (payload?.threadId || imageHistory.activeThreadId))!
    if (payload?.messages) previous.messages = payload.messages
    const id = 'new-image-thread'
    imageHistory.threads.push({ id, title: '', createdAt: 2, updatedAt: 2, contextFiles: [], messages: [] })
    imageHistory.activeThreadId = id
    return JSON.parse(JSON.stringify(imageHistory))
  },
  onAiChatStream: () => () => {},
  aiChatStream: async (_id: string, messages: any[]) => { calls.aiRequests.push(messages); return { content: '截图分析完成' } },
  getConnectionUsageStatsEnabled: async () => true,
  getAllSettings: async () => ({}),
  getConnections: async () => connections.map(conn => ({ ...conn })),
  getGroups: async () => groups.map(group => ({ ...group })),
  setManySettings: async () => {},
  updateConnectionGroup: async (id: string, group: string) => {
    calls.moves.push(`${id}:${group}`)
    connections = connections.map(conn => conn.id === id ? { ...conn, group } : conn)
  },
  reorderConnections: async () => { calls.reorders++ },
  sftpEditorSnapshot: async () => ({ content: remoteContent, revision: remoteRevision }),
  sftpEditorSave: async (_sid: string, _path: string, content: string, options: { revision: string; backup?: boolean }) => {
    if (typeof options.revision !== 'string') throw new Error('Save click supplied an event instead of a revision')
    calls.editorSaves.push({ content, options })
    if (options.revision !== remoteRevision) return { status: 'conflict', revision: remoteRevision }
    remoteContent = content
    remoteRevision = 'c'.repeat(64)
    return { status: 'saved', revision: remoteRevision, backupPath: options.backup ? '/tmp/config.backup' : undefined }
  },
  selectDirectory: async () => 'C:/ui-fixture',
  sftpDirectoryPreview: async () => {
    if (previewFails) throw new Error('Preview unavailable')
    return {
    localPath: 'C:/ui-fixture', remotePath: '/tmp', skipped: 1,
    entries: ['new', 'changed', 'same', 'blocked'].map(status => ({ name: `${status}.txt`, localPath: `C:/ui-fixture/${status}.txt`, size: 3, status })),
    }
  },
  sftpUpload: (...args: any[]) => calls.uploads.push(args),
}

const bookmarkAnchor = ref<HTMLElement | null>(null)
const bookmarksOpen = ref(false)
const editorOpen = ref(false)
const syncOpen = ref(false)
const aiMessages = ref<ChatItem[]>([])
const imageComposerOpen = ref(false)
const imageComposerSession = ref('image-fixture')
const imageOpenGeneration = ref(1)
const renameText = ref('重命名后的服务器日志 Production logs ' + '很长的名称'.repeat(12))
const bookmarks = ref<SftpPathBookmark[]>([
  { id: 'bookmark-one', name: 'logs', path: '/var/log/application', scope: 'connection', connectionId: 'one', order: 0, createdAt: 1, updatedAt: 1 },
  { id: 'bookmark-two', name: '服务器日志', path: '/var/log/global', scope: 'global', order: 0, createdAt: 1, updatedAt: 1 },
])
function renameBookmark(item: SftpPathBookmark) {
  bookmarks.value = bookmarks.value.map(bookmark => bookmark.id === item.id ? { ...bookmark, name: renameText.value } : bookmark)
  bookmarksOpen.value = true
}

onMounted(() => {
  (window as any).__uiRegression = {
    calls,
    async openImageComposer() { imageOpenGeneration.value++; imageComposerOpen.value = true; await nextTick() },
    async closeImageComposer() { imageComposerOpen.value = false; await nextTick() },
    async switchImageSession(id: string) { imageComposerSession.value = id; await nextTick() },
    imageSessionState(id: string) {
      const state = useAiChat().getSessionState(id)
      return { threadId: state.activeThreadId, input: state.input, messages: state.messages.map(message => ({ id: message.id, content: message.content })) }
    },
    changeSavedActiveThread() {
      imageHistory.threads.push({ id: 'another-terminal-thread', title: '', createdAt: 2, updatedAt: 2, contextFiles: [], messages: [] })
      imageHistory.activeThreadId = 'another-terminal-thread'
    },
    async setCompactionCount(count: number) {
      useAiChat().getSessionState('image-fixture').compactionCount = count
      imageHistory.threads.find(thread => thread.id === imageHistory.activeThreadId)!.compactionCount = count
      await nextTick()
    },
    getImageHistory() { return JSON.parse(JSON.stringify(imageHistory)) },
    async setVisionEnabled(enabled: boolean) {
      imageSettings.providers[0].models[0].supportsImages = enabled
      useAiChat().replaceSettings(JSON.parse(JSON.stringify(imageSettings)))
      await nextTick()
    },
    async setTheme(theme: 'dark' | 'light' | 'eyecare' | 'custom', colors?: { fontColor: string; bgColor: string }) {
      const { useTheme } = await import('../../src/composables/app/useTheme')
      const api = useTheme()
      if (colors) api.setCustomColors(colors)
      api.setTheme(theme)
      await nextTick()
    },
    async closeBookmarks() { bookmarksOpen.value = false; await nextTick() },
    async openEditor() { editorOpen.value = true; await nextTick() },
    changeRemote() { remoteContent = 'external change'; remoteRevision = 'b'.repeat(64) },
    failPreview() { previewFails = true },
    restorePreview() { previewFails = false },
    async openSync() { syncOpen.value = true; await nextTick() },
    async aiPhase(phase: AiActivityPhase, quietMs = 0) {
      const now = Date.now()
      aiMessages.value = [{
        id: 'ai-fixture', role: 'assistant', content: '', createdAt: now - quietMs, streaming: true,
        activity: { phase, phaseStartedAt: now - quietMs, lastActivityAt: now - quietMs },
        reasoningContent: phase === 'reasoning' ? '正在分析部署脚本' : undefined,
        segments: phase === 'reasoning' ? [{ kind: 'reasoning', text: '正在分析部署脚本' }] : [],
      }]
      await nextTick()
    },
    async finishAi() { aiMessages.value = aiMessages.value.map(message => ({ ...message, streaming: false })); await nextTick() },
    async aiTimeline(count = 35) {
      aiMessages.value = Array.from({ length: count }, (_, i) => [
        { id: `timeline-user-${i}`, role: 'user' as const, content: `第 ${i + 1} 次部署问题`, createdAt: i * 2 },
        { id: `timeline-reply-${i}`, role: 'assistant' as const, content: '这里是部署检查结果。', createdAt: i * 2 + 1 },
      ]).flat()
      await nextTick()
    },
    async longAiReply() {
      const now = Date.now()
      aiMessages.value = [{
        id: 'ai-long', role: 'assistant', content: '这是一行较长的部署检查输出\n'.repeat(70), createdAt: now, streaming: true,
        activity: { phase: 'waiting', phaseStartedAt: now, lastActivityAt: now },
      }]
      await nextTick()
    },
    async delayAiReply() {
      aiMessages.value[0].activity!.lastActivityAt = Date.now() - 31000
      await nextTick()
    },
    async resumeAiReply() {
      aiMessages.value[0].activity = { phase: 'requesting', phaseStartedAt: Date.now(), lastActivityAt: Date.now() }
      await nextTick()
    },
    async openBookmarks() { bookmarksOpen.value = true; await nextTick() },
    async setName(name: string) {
      bookmarks.value = bookmarks.value.map(bookmark => ({ ...bookmark, name }))
      await nextTick()
    },
    async setWidth(width: number) {
      document.querySelector<HTMLElement>('.file-sidebar')!.style.width = `${width}px`
      await nextTick()
    },
  }
})
</script>

<template>
  <main class="regression-root">
    <section class="connection-fixture">
      <ConnectionsView :initial-data="initialData" @connect="calls.connects.push($event)" />
    </section>
    <section class="file-sidebar">
      <button ref="bookmarkAnchor" @click="bookmarksOpen = true">书签布局验证</button>
      <SftpBookmarkMenu
        :open="bookmarksOpen" :anchor="bookmarkAnchor" current-path="/var/log/application"
        :connection-bookmarks="bookmarks.filter(item => item.scope === 'connection')"
        :global-bookmarks="bookmarks.filter(item => item.scope === 'global')"
        @close="bookmarksOpen = false" @rename-bookmark="renameBookmark"
      />
    </section>
    <section class="sftp-toolbar-fixture">
      <SftpToolbar :active-transfers="3" :follow-terminal-path="true" terminal-label="很长的终端名称 Terminal one" terminal-target="Server / Terminal one"
        @collapse-tree="calls.sftpActions.push('collapse-tree')" @upload-folder="calls.sftpActions.push('upload-folder')" @directory-sync="calls.sftpActions.push('directory-sync')" />
    </section>
    <section class="label-fixture">
      <InlineLabel text="很长的中文与英文数据库名称 Production database"><span class="fixture-count">123456</span></InlineLabel>
    </section>
    <section class="ai-fixture"><AiChatView :messages="aiMessages" :has-api-configured="true" /></section>
    <section v-if="imageComposerOpen" class="ai-image-composer-fixture"><AiSidebar :session-id="imageComposerSession" :open-generation="imageOpenGeneration" /></section>
    <FileEditorModal :visible="editorOpen" session-id="ui-fixture" remote-path="/tmp/config" file-name="config" @close="editorOpen = false" />
    <DirectorySyncModal :visible="syncOpen" session-id="ui-fixture" remote-path="/tmp" @close="syncOpen = false" />
    <AppDialogHost />
  </main>
</template>

<style>
/* Deterministic snapshots: hidden windows do not advance every transition frame. */
*, *::before, *::after { transition: none !important; }
.regression-root { padding: 12px; height: 100%; overflow: auto; }
.connection-fixture { display: flex; width: min(1050px, 100%); height: 520px; }
.file-sidebar { position: relative; width: 320px; height: 240px; margin-top: 16px; }
.sftp-toolbar-fixture { container-type: inline-size; width: 320px; padding: 6px; margin-top: 12px; height: 160px; background: var(--bg-secondary); }
.label-fixture { display: flex; width: 220px; font-size: 12px; }
.fixture-count { font-size: 10px; }
.ai-fixture { display: flex; width: 440px; height: 280px; margin-top: 12px; }
.ai-image-composer-fixture { position: relative; display: flex; width: 440px; height: 620px; margin-top: 12px; }
</style>
