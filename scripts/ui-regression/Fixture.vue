<script setup lang="ts">
import { nextTick, onMounted, provide, ref } from 'vue'
import SynchronizedInputBar from '../../src/components/terminal/SynchronizedInputBar.vue'
import { createSynchronizedInput, synchronizedInputKey } from '@/composables/terminal/useSynchronizedInput'
import ConnectionsView from '../../src/views/ConnectionsView.vue'
import SftpBookmarkMenu from '../../src/components/sftp/SftpBookmarkMenu.vue'
import InlineLabel from '../../src/components/common/InlineLabel.vue'
import AiChatView from '../../src/components/ai/AiChatView.vue'
import AiSidebar from '../../src/components/ai/AiSidebar.vue'
import AiWorkspaceView from '../../src/views/AiWorkspaceView.vue'
import AppTitlebar from '../../src/components/app/AppTitlebar.vue'
import LeftToolbar from '../../src/components/workspace/LeftToolbar.vue'
import { useAiBackgroundJobs } from '../../src/composables/ai/useAiBackgroundJobs'
import type { SshMcpJobSummary } from '../../shared/mcp/types'
import { useAiChat } from '../../src/composables/ai/useAiChat'
import type { AiSessionStore, AiSettings, AiToolRun, AiUsage } from '../../shared/types/ai'
import type { AiScheduleInput, AiScheduleRun, AiScheduleSnapshot } from '../../shared/aiSchedules'
import { aiScheduleConnectionIds, nextAiScheduleRun } from '../../shared/aiSchedules'
import FileEditorModal from '../../src/components/sftp/FileEditorModal.vue'
import DirectorySyncModal from '../../src/components/sftp/DirectorySyncModal.vue'
import SftpToolbar from '../../src/components/sftp/SftpToolbar.vue'
import SftpDirTree from '../../src/components/sftp/SftpDirTree.vue'
import AppDialogHost from '../../src/components/app/AppDialogHost.vue'
import type { ChatItem } from '../../src/composables/ai/useAiChat'
import type { AiActivityPhase } from '../../src/utils/ai/chatActivity'
import type { Connection, Group } from '../../shared/types/connection'
import type { AiWorkspaceConversationItem } from '../../shared/aiWorkspaceConversations'
import type { SshConnectionStage } from '../../shared/sshConnectionProgress'
import type { FileEntry, SftpPathBookmark } from '../../shared/types/sftp'

const groups: Group[] = [
  { id: 'dev', name: '默认分组', order: 0, isDefault: true },
  { id: 'prod', name: '生产环境 Production', order: 1, isDefault: false },
]
let connections: Connection[] = [
  { id: 'one', name: '服务器一 Server one', group: 'dev', host: 'dev.example.test', port: 22, username: 'tester', password: '', colorTag: 'orange', createdAt: 1, updatedAt: 1 },
  { id: 'two', name: '服务器二 Server two', group: 'prod', host: 'prod.example.test', port: 22, username: 'tester', password: '', createdAt: 2, updatedAt: 2 },
]
const initialData = { groups, connections }
let workspaceHistory: AiWorkspaceConversationItem[] = []
const scopeStores = new Map<string, AiSessionStore>()
let workspaceScopes: Array<{ id: string; connectionIds: string[]; createdAt: number }> = []
const historyFor = (id: string) => scopeStores.get(id) || (id === 'other-fixture' ? otherImageHistory : imageHistory)
const synchronizedInput = createSynchronizedInput()
provide(synchronizedInputKey, synchronizedInput)
const synchronizedWrites: string[] = []
for (const id of ['one', 'two']) synchronizedInput.register(id, { writable: () => true, receive: data => synchronizedWrites.push(`${id}:${data}`) })
const synchronizedSessions = connections.map(conn => ({ id: conn.id, connectionName: conn.name, sshAddress: conn.host, tabNumber: 1, terminalLabel: '终端 1', displayName: `${conn.name} / 终端 1` }))
const connectionStages = ref<Record<string, SshConnectionStage>>({})
const cancelledConnections: string[] = []
const calls = { clipboardWrites: [] as string[], connects: [] as string[], moves: [] as string[], reorders: 0, editorSaves: [] as any[], uploads: [] as any[], sftpActions: [] as string[], aiRequests: [] as any[], aiCreates: [] as string[] }
const imageSettings: AiSettings = { providers: [{ id: 'fixture', name: '测试接口', baseUrl: 'https://example.test/v1', apiKey: 'fixture-only', models: [{ id: 'vision-fixture', supportsImages: true }] }], activeProviderId: 'fixture', activeModel: 'vision-fixture', systemPrompt: '' }
let imageHistory: AiSessionStore = { version: 1, activeThreadId: 'image-thread', defaultContextFiles: [], threads: [{ id: 'image-thread', title: '旧窗口的对话', createdAt: 1, updatedAt: 1, contextFiles: [], messages: [{ id: 'old-host-message', role: 'user', content: '旧窗口的历史消息', createdAt: 1 }] }] }
const otherImageHistory: AiSessionStore = { version: 1, activeThreadId: 'other-thread', defaultContextFiles: [], threads: [{ id: 'other-thread', title: '', createdAt: 1, updatedAt: 1, contextFiles: [], messages: [] }] }
let remoteContent = 'original content'
let remoteRevision = 'a'.repeat(64)
let previewFails = false
let backgroundJobs: SshMcpJobSummary[] = []
let cancelJobFails = false
const jobListeners = new Set<(jobs: SshMcpJobSummary[]) => void>()
const backgroundReplyListeners = new Set<(event: any) => void>()
const workspaceListeners = new Set<(event: any) => void>()
const workspaceSessions = new Map<string, string>()
const workspaceOpens: string[] = []
const scheduleState: AiScheduleSnapshot = { plans: [], runs: [] }
const scheduleListeners = new Set<(state: AiScheduleSnapshot) => void>()
const scheduleResolvers = new Map<string, (run: AiScheduleRun) => void>()
let notificationSettings = { enabled: false, url: '', mode: 'issues' as 'issues' | 'all', hasToken: false }
let notificationTestFails = false
function publishSchedules() { scheduleListeners.forEach(listener => listener(structuredClone(scheduleState))) }
function finishSchedule(status: 'completed' | 'cancelled' | 'failed') {
  const run = scheduleState.runs.find(item => item.status === 'running')
  if (!run) return
  Object.assign(run, { status, finishedAt: Date.now(), content: status === 'completed' ? '巡检完成，磁盘空间正常。' : undefined,
    toolRuns: status === 'completed' ? [{ id: 'inspect-disk', name: 'exec', args: '{"command":"df -h"}', content: '{"exitCode":0,"stdout":"disk healthy"}', status: 'done', isError: false }] : [] })
  run.health = 'healthy'
  if (run.hosts) for (const host of run.hosts) Object.assign(host, { status, health: 'healthy', content: status === 'completed' ? '本机磁盘正常。' : undefined, toolRuns: run.toolRuns?.map(tool => ({ ...tool, reason: '检查磁盘空间' })) })
  if (status === 'failed' && run.hosts?.length) {
    run.health = 'warning'
    run.error = '部分巡检工具未能执行，请查看工具详情。'
    run.content = '1. 磁盘使用率偏高\n\n   - 已读取磁盘指标\n\n1. 部分检查未完成\n\n   - 一条命令被只读策略拦截'
    run.hosts.forEach((host, index) => Object.assign(host, { status: index ? 'completed' : 'failed', health: index ? 'healthy' : 'warning', content: index ? '本机磁盘正常。' : '磁盘使用率偏高，另有一条命令未能执行。', error: index ? undefined : run.error,
      toolRuns: [{ id: 'inspect-disk', name: 'exec', args: '{"command":"df -h"}', reason: '检查磁盘空间', content: '{"exitCode":0,"stdout":"disk healthy"}', status: 'done', isError: false }, { id: 'blocked-check', name: 'exec', args: '{"command":"custom-inspect"}', reason: '检查服务配置', content: '命令被只读策略拦截', status: 'blocked', isError: true }],
    }))
  }
  run.notification = { status: status === 'cancelled' || !notificationSettings.enabled || notificationSettings.mode === 'issues' ? 'skipped' : 'sent' }
  publishSchedules()
  scheduleResolvers.get(run.id)?.(structuredClone(run))
  scheduleResolvers.delete(run.id)
}
// This test window has no production preload, credentials, SSH or disk writes.
;(window as any).LiteConnect = {
  clipboardWriteText: async (text: string) => { calls.clipboardWrites.push(text) },
  getAiSettings: async () => JSON.parse(JSON.stringify(imageSettings)),
  aiGetNotificationSettings: async () => ({ ...notificationSettings }),
  aiSaveNotificationSettings: async (input: any) => { notificationSettings = { enabled: input.enabled, url: input.url, mode: input.mode, hasToken: input.token ? true : input.token === '' ? false : notificationSettings.hasToken }; return { ...notificationSettings } },
  aiTestNotification: async () => ({ status: notificationTestFails ? 'failed' : 'sent', error: notificationTestFails ? '通知服务不可用' : undefined }),
  aiListSchedules: async () => structuredClone(scheduleState),
  onAiSchedulesChanged: (listener: (state: AiScheduleSnapshot) => void) => { scheduleListeners.add(listener); return () => scheduleListeners.delete(listener) },
  aiSaveSchedule: async (input: AiScheduleInput) => {
    const previous = scheduleState.plans.find(plan => plan.id === input.id)
    const plan = { ...input, id: input.id || `plan-${scheduleState.plans.length}`, createdAt: previous?.createdAt || Date.now(), updatedAt: Date.now(), nextRunAt: nextAiScheduleRun(input, Date.now()), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }
    const index = scheduleState.plans.findIndex(item => item.id === plan.id)
    if (index < 0) scheduleState.plans.push(plan)
    else scheduleState.plans[index] = plan
    publishSchedules()
    return structuredClone(plan)
  },
  aiRemoveSchedule: async (id: string) => { scheduleState.plans = scheduleState.plans.filter(plan => plan.id !== id); scheduleState.runs = scheduleState.runs.filter(run => run.scheduleId !== id); publishSchedules() },
  aiRunSchedule: async (id: string) => {
    const plan = scheduleState.plans.find(item => item.id === id)!
    const run: AiScheduleRun = { id: `run-${scheduleState.runs.length}`, scheduleId: id, name: plan.name, connectionId: plan.connectionId, startedAt: Date.now(), status: 'running' }
    run.hosts = aiScheduleConnectionIds(plan).map(connectionId => ({ connectionId, name: connections.find(connection => connection.id === connectionId)?.name || connectionId, status: 'running' }))
    scheduleState.runs.unshift(run)
    publishSchedules()
    return new Promise<AiScheduleRun>(resolve => scheduleResolvers.set(run.id, resolve))
  },
  aiStopScheduleRun: async () => finishSchedule('cancelled'),
  aiListWorkspaceConversations: async () => structuredClone([...workspaceHistory, ...workspaceScopes.flatMap(scope =>
    (scopeStores.get(scope.id)?.threads || []).filter(thread => thread.messages.length).map(thread => ({
      workspaceId: scope.id, connectionIds: scope.connectionIds, connectionId: scope.id, threadId: thread.id,
      title: thread.messages[0]?.content || '', updatedAt: Date.now(), messageCount: thread.messages.length,
      hostLabel: scope.connectionIds.map(id => connections.find(host => host.id === id)?.name).join('、'),
    }))),
  ]),
  aiOpenWorkspaceScope: async (input: { connectionIds?: string[]; id?: string }) => {
    // Match Electron IPC serialization before the mock constructs its own objects.
    input = structuredClone(input)
    if (input.id) return structuredClone(workspaceScopes.find(scope => scope.id === input.id))
    const scope = { id: `workspace:fixture-${workspaceScopes.length}`, connectionIds: [...input.connectionIds!], createdAt: Date.now() }
    workspaceScopes.push(scope)
    scopeStores.set(scope.id, { version: 1, activeThreadId: 'initial', defaultContextFiles: [], threads: [{ id: 'initial', title: '', createdAt: 1, updatedAt: 1, contextFiles: [], messages: [] }] })
    return structuredClone(scope)
  },
  onAiWorkspaceConnection: (listener: (event: any) => void) => { workspaceListeners.add(listener); return () => workspaceListeners.delete(listener) },
  aiOpenWorkspaceConnection: async (id: string) => {
    workspaceOpens.push(id)
    const sessionId = workspaceSessions.get(id) || `ai-workspace-${id}-${workspaceOpens.length}`
    workspaceSessions.set(id, sessionId)
    workspaceListeners.forEach(listener => listener({ connectionId: id, sessionId, status: 'connected' }))
    return sessionId
  },
  aiCancelWorkspaceConnection: async () => {},
  aiCloseWorkspaceConnection: async (sessionId: string) => {
    for (const [connectionId, id] of workspaceSessions) if (id === sessionId) {
      workspaceSessions.delete(connectionId)
      workspaceListeners.forEach(listener => listener({ connectionId, sessionId, status: 'closed' }))
    }
  },
  mcpListJobs: async () => backgroundJobs,
  aiSuppressBackgroundReplies: async () => {},
  onAiBackgroundReply: (listener: (event: any) => void) => { backgroundReplyListeners.add(listener); return () => backgroundReplyListeners.delete(listener) },
  mcpCallTool: async (name: string, args: { jobId: string }) => {
    if (name !== 'get_job' && name !== 'cancel_job') throw new Error('Unexpected tool in background task details')
    const job = backgroundJobs.find(item => item.jobId === args.jobId)
    if (!job) return { isError: true, content: 'JOB_NOT_FOUND', structuredContent: {} }
    if (name === 'cancel_job') {
      if (cancelJobFails) return { isError: true, content: 'fixture cancellation failed', structuredContent: {} }
      job.status = 'cancelled'
      job.finishedAt = Date.now()
      jobListeners.forEach(listener => listener(backgroundJobs.map(item => ({ ...item }))))
    }
    return { isError: false, content: '', structuredContent: { ...job, stdout: job.status === 'running' ? undefined : 'container restarted\nverification passed', stderr: job.status === 'failed' ? 'restart failed' : '', truncated: false } }
  },
  onMcpJobsChanged: (listener: (jobs: SshMcpJobSummary[]) => void) => { jobListeners.add(listener); return () => jobListeners.delete(listener) },
  listAiModels: async () => [{ id: 'vision-fixture', contextWindowTokens: 64000 }],
  getAiSessionStore: async (id: string) => JSON.parse(JSON.stringify(historyFor(id))),
  setAiSessionStore: async (id: string, store: AiSessionStore) => { if (id.startsWith('workspace:')) scopeStores.set(id, store); else imageHistory = store },
  appendAiSessionHistory: async (_id: string, record: any, threadId: string) => { historyFor(_id).threads.find(thread => thread.id === threadId)!.messages.push(record) },
  aiCreateConversation: async (_id: string, payload: any) => {
    calls.aiCreates.push(_id)
    const history = historyFor(_id)
    const previous = history.threads.find(thread => thread.id === (payload?.threadId || history.activeThreadId))!
    if (payload?.messages) previous.messages = payload.messages
    const id = `new-image-thread-${calls.aiCreates.length}`
    history.threads.push({ id, title: '', createdAt: 2, updatedAt: 2, contextFiles: [], messages: [] })
    history.activeThreadId = id
    return JSON.parse(JSON.stringify(history))
  },
  onAiChatStream: () => () => {},
  aiChatStream: async (_id: string, messages: any[], options: any) => { calls.aiRequests.push(messages); return { content: (options?.sessionId?.startsWith('ai-workspace-') || options?.sessionId?.startsWith('workspace:')) ? '服务器磁盘和服务状态正常。\n\n```sh\ndf -h\n```' : '截图分析完成' } },
  getConnectionUsageStatsEnabled: async () => true,
  getAllSettings: async () => ({}),
  getConnections: async () => connections.map(conn => ({ ...conn })),
  setConnectionPinned: async (id: string, pinned: boolean) => {
    const connection = connections.find(conn => conn.id === id)
    if (!connection) throw new Error('Fixture connection not found')
    connection.pinned = pinned
    return { ...connection }
  },
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
const liteAiOpen = ref(false)
const liteAiActive = ref(true)
const liteAiMode = ref<'ssh' | 'ai'>('ssh')
const imageComposerSession = ref('image-fixture')
const { runningCount: backgroundTaskCount } = useAiBackgroundJobs(() => imageComposerSession.value)
const imageOpenGeneration = ref(1)
const renameText = ref('重命名后的服务器日志 Production logs ' + '很长的名称'.repeat(12))
const bookmarks = ref<SftpPathBookmark[]>([
  { id: 'bookmark-one', name: 'logs', path: '/var/log/application', scope: 'connection', connectionId: 'one', order: 0, createdAt: 1, updatedAt: 1 },
  { id: 'bookmark-two', name: '服务器日志', path: '/var/log/global', scope: 'global', order: 0, createdAt: 1, updatedAt: 1 },
])
const treeEntries = ref<FileEntry[]>([
  { name: 'config.log', path: '/config.log', isDirectory: false, isSymlink: false, size: 5500, modifyTime: 1, permissions: 'rw-r--r--' },
])
function renameBookmark(item: SftpPathBookmark) {
  bookmarks.value = bookmarks.value.map(bookmark => bookmark.id === item.id ? { ...bookmark, name: renameText.value } : bookmark)
  bookmarksOpen.value = true
}

onMounted(() => {
  (window as any).__uiRegression = {
    calls,
    workspaceOpens,
    workspaceScopes,
    async setWorkspaceActive(active: boolean) { liteAiActive.value = active; await nextTick() },
    setWorkspacePreview(hosts: Connection[], history: AiWorkspaceConversationItem[]) {
      connections = hosts
      workspaceScopes.length = 0; scopeStores.clear(); workspaceHistory = history
    },
    async seedLegacyWorkspaceHistory(connectionId: string) {
      const connection = connections.find(host => host.id === connectionId)!
      const threadId = `legacy-${connectionId}-${Date.now()}`
      imageHistory.threads.push({ id: threadId, title: '旧版单机会话', createdAt: Date.now(), updatedAt: Date.now(), contextFiles: [], messages: [{ id: `${threadId}-message`, role: 'user', content: '恢复旧版单机历史', createdAt: Date.now() }] })
      workspaceHistory = [{ connectionId, hostLabel: connection.name, threadId, title: '旧版单机会话', updatedAt: Date.now(), messageCount: 1 }, ...workspaceHistory]
      await nextTick()
    },
    async seedWorkspaceResponse() {
      const scope = workspaceScopes.at(-1)!
      const state = useAiChat().getSessionState(scope.id)
      const hosts = scope.connectionIds.map(id => connections.find(host => host.id === id)!)
      const content = '## 跨服务器汇总\n| 服务器 | 状态 |\n| --- | --- |\n' + hosts.map(host => `| ${host.name} | 正常 |`).join('\n') + '\n' + hosts.map(host => `## ${host.name} (${host.host})\n服务正常\n\n\`\`\`bash\nfree -h\n\`\`\`\n`).join('\n') + '\n## 下一步\n检查服务间连接'
      state.messages.push({ id: 'workspace-response', role: 'assistant', content, createdAt: Date.now() })
      await nextTick()
    },
    async seedWorkspaceRail() {
      workspaceHistory = Array.from({ length: 14 }, (_, index) => ({
        connectionId: connections[index % connections.length].id,
        hostLabel: connections[index % connections.length].name,
        threadId: `rail-history-${index}`,
        title: `历史会话 ${index + 1}：检查服务器服务与磁盘状态`,
        updatedAt: Date.now() - index * 86_400_000,
        messageCount: 6,
      }))
      for (const connection of connections) await window.LiteConnect.aiOpenWorkspaceConnection(connection.id)
    },
    finishSchedule: () => finishSchedule('completed'),
    failSchedule: () => finishSchedule('failed'),
    scheduleSnapshot: () => structuredClone(scheduleState),
    failNotificationTest: (value: boolean) => { notificationTestFails = value },
    async openLiteAi() {
      syncOpen.value = false
      imageComposerOpen.value = false
      connections = connections.map((connection, index) => ({ ...connection, name: index === 0 ? '应用服务器' : '数据库服务器' }))
      liteAiOpen.value = true
      await nextTick()
    },
    synchronizedWrites,
    sendSynchronizedInput(data: string) { synchronizedInput.forward('one', data) },
    cancelledConnections,
    async setConnectionStage(stage?: SshConnectionStage) { connectionStages.value = stage ? { one: stage } : {}; await nextTick() },
    async seedScopedJobs() {
      const scope = workspaceScopes[0]
      const state = useAiChat().getSessionState(scope.id)
      const assistant = [...state.messages].reverse().find(message => message.role === 'assistant')!
      const jobs = scope.connectionIds.map((id, index) => ({ jobId: `scope-job-${index}`, sessionId: workspaceSessions.get(id)!, command: `inspect host ${index}`, startedAt: Date.now(), status: 'running' as const }))
      assistant.toolRuns = jobs.map((job, index) => ({ id: `scope-tool-${index}`, name: 'exec', args: '{}', content: 'started', isError: false, status: 'done', target: connections.find(host => host.id === scope.connectionIds[index])!.name, jobIds: [job.jobId] }))
      assistant.segments = [...(assistant.segments || []), ...assistant.toolRuns.map(run => ({ kind: 'tool' as const, runId: run.id }))]
      backgroundJobs = [...jobs, { ...jobs[1], jobId: 'another-conversation-job', command: 'unrelated task' }]
      jobListeners.forEach(listener => listener(backgroundJobs))
      await nextTick()
    },
    async disconnectScopedHost() {
      const session = workspaceSessions.get(workspaceScopes[0].connectionIds[0])!
      await window.LiteConnect.aiCloseWorkspaceConnection(session)
      backgroundJobs = backgroundJobs.map(job => job.sessionId === session && job.jobId.startsWith('scope-job-') ? { ...job, status: 'cancelled' } : job)
      jobListeners.forEach(listener => listener(backgroundJobs))
    },
    scopedJobStatus: () => backgroundJobs.map(job => [job.jobId, job.status]),
    setBackgroundJobs(jobs: SshMcpJobSummary[]) { backgroundJobs = jobs; jobListeners.forEach(listener => listener(jobs)) },
    setCancelJobFailure(value: boolean) { cancelJobFails = value },
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
    seedConversationMessage() {
      const state = useAiChat().getSessionState(imageComposerSession.value)
      state.messages.push(useAiChat().createMessage('user', '正在等待后台任务'))
    },
    emitBackgroundReply(status: 'running' | 'completed') {
      const threadId = useAiChat().getSessionState(imageComposerSession.value).activeThreadId
      const event = { sessionId: imageComposerSession.value, threadId, requestId: 'fixture-background-request', record: {
        id: 'fixture-background-assistant', role: 'assistant', status, createdAt: Date.now(),
        content: status === 'completed' ? '后台命令已完成并验证结果。' : '',
        backgroundNotice: 'Application completion\n' + JSON.stringify([{ command: 'verify-container', stdout: 'container healthy' }]),
      } }
      backgroundReplyListeners.forEach(listener => listener(event))
    },
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
    async aiUsage(usage: AiUsage) {
      aiMessages.value = [{ id: 'ai-usage', role: 'assistant', content: '多服务器检查完成。', createdAt: Date.now(), completedAt: Date.now(), usage }]
      await nextTick()
    },
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
    async aiTools(toolRuns: AiToolRun[]) {
      aiMessages.value = [{ id: 'ai-tools', role: 'assistant', content: '', createdAt: Date.now(), streaming: true, toolRuns }]
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
    async setTreeName(name: string) {
      treeEntries.value = [{ ...treeEntries.value[0], name, path: '/' + name }]
      await nextTick()
    },
  }
})
</script>

<template>
  <main class="regression-root">
    <section class="synchronized-input-fixture"><SynchronizedInputBar :sessions="synchronizedSessions" :open="true" /></section>
    <section class="connection-fixture">
      <ConnectionsView :initial-data="initialData" :connection-stages="connectionStages" :connecting-connection-ids="new Set(Object.keys(connectionStages))" @connect="calls.connects.push($event)" @cancel-connect="cancelledConnections.push($event)" />
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
    <section class="sftp-tree-fixture">
      <SftpDirTree current-path="/" :entries-of="path => path === '/' ? treeEntries : []" :is-expanded="() => false" :is-loading="() => false" :can-edit="() => true" />
    </section>
    <section class="label-fixture">
      <InlineLabel text="很长的中文与英文数据库名称 Production database"><span class="fixture-count">123456</span></InlineLabel>
    </section>
    <section class="ai-fixture"><AiChatView :messages="aiMessages" :has-api-configured="true" /></section>
    <section v-if="imageComposerOpen" class="ai-image-composer-fixture"><AiSidebar :session-id="imageComposerSession" :open-generation="imageOpenGeneration" /></section>
    <section class="background-toolbar-fixture"><LeftToolbar :ai-active="imageComposerOpen" :files-active="false" :monitor-active="false" :batch-active="false" :snippets-active="false" :show-ai-unread="false" :background-task-count="backgroundTaskCount" /></section>
    <FileEditorModal :visible="editorOpen" session-id="ui-fixture" remote-path="/tmp/config" file-name="config" @close="editorOpen = false" />
    <DirectorySyncModal :visible="syncOpen" session-id="ui-fixture" remote-path="/tmp" @close="syncOpen = false" />
    <AppDialogHost />
    <section v-if="liteAiOpen" class="lite-ai-workspace-fixture">
      <AppTitlebar :app-mode="liteAiMode" :show-settings-page="false" @enter-ai="liteAiMode = 'ai'" @enter-ssh="liteAiMode = 'ssh'" />
      <AiWorkspaceView v-if="liteAiMode === 'ai'" :active="liteAiActive" />
    </section>
  </main>
</template>

<style>
/* Deterministic snapshots: hidden windows do not advance every transition frame. */
*, *::before, *::after { transition: none !important; }
.regression-root { padding: 12px; height: 100%; overflow: auto; }
.connection-fixture { display: flex; width: min(1050px, 100%); height: 520px; }
.file-sidebar { position: relative; width: 320px; height: 240px; margin-top: 16px; }
.sftp-toolbar-fixture { container-type: inline-size; width: 320px; padding: 6px; margin-top: 12px; height: 160px; background: var(--bg-secondary); }
.sftp-tree-fixture { display: flex; width: 360px; height: 160px; margin-top: 12px; }
.label-fixture { display: flex; width: 220px; font-size: 12px; }
.fixture-count { font-size: 10px; }
.ai-fixture { display: flex; width: 440px; height: 280px; margin-top: 12px; }
.ai-image-composer-fixture { position: relative; display: flex; width: 440px; height: 620px; margin-top: 12px; }
.lite-ai-workspace-fixture { width: min(1050px, 100%); height: 680px; display: flex; flex-direction: column; margin-top: 12px; }
.lite-ai-workspace-fixture > .ai-workspace { flex: 1; height: auto; }
</style>
