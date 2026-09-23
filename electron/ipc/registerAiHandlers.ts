import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readFile, stat } from 'fs/promises'
import { SettingsStore } from '../store/settingsStore'
import { t } from '../i18n'
import type { SshMcpRuntime } from '../mcp/runtime'
import { listAiProviderModels, testAiProviderConfig, validateAiSettings } from '../ai/providerHttp'
import {
  createNewConversationAtomic,
  AI_CONTEXT_FILE_MAX_BYTES,
  getActiveThread,
  normalizeAiContextFile,
  normalizeSessionStore,
  pruneAllAiHistoryStores,
  readAiSessionStore,
  readAiSessionStoreAndGc,
  removeAiConversationContextFile,
  setAiConversationContextFile,
  upsertAiHistoryRecord,
  writeAiHistoryRecords,
  writeAiContextCheckpoint,
  writeAiSessionStore,
} from '../ai/historyStore'
import { abortAiChatStream, createAiStreamControl, resolveToolApproval, runAiChatStream } from '../ai/chatStream'
import type { AiChatStreamOptions, AiContextCheckpoint } from '../../shared/types/ai'
import { runAiChatCompletion } from '../ai/chatCompletion'
import { runPersistedAiReply } from '../ai/streamPersistence'
import { createStreamPublisher } from '../ai/streamPublisher'
import { flattenConversationForApi } from '../../shared/aiMessages'
import { isAiMarkdownFilePath } from '../../shared/aiFixedContext'
import { showAiApprovalNotification } from '../ai/approvalNotification'

export function registerAiHandlers(
  settingsStore: SettingsStore,
  sshMcpRuntime?: SshMcpRuntime,
  resolveHistoryId?: (sessionId: string) => string | undefined,
): void {
  const ensureSettingsReady = () => settingsStore.init().then(() => settingsStore.initMigrations())
  const getHistoryLimits = () => {
    const settings = settingsStore.getAiSettings()
    return {
      maxThreads: settings.historyMaxThreads,
      maxMessages: settings.historyMaxMessages,
    }
  }
  const runningHistories = new Set<string>()
  const historyIdsBySession = new Map<string, string>()

  const historyIdForSession = (sessionId: string): string => {
    if (!sessionId || typeof sessionId !== 'string') throw new Error('Invalid AI session id')
    const cached = historyIdsBySession.get(sessionId)
    if (cached) return cached
    const historyId = resolveHistoryId?.(sessionId)
    if (!historyId) throw new Error('SSH host is unavailable for AI history')
    historyIdsBySession.set(sessionId, historyId)
    return historyId
  }

  ipcMain.handle('settings:getAiSettings', async () => {
    await ensureSettingsReady()
    return settingsStore.getAiSettings()
  })

  ipcMain.handle('settings:setAiSettings', async (_event, settings: any) => {
    await ensureSettingsReady()
    const previousLimits = getHistoryLimits()
    await settingsStore.setAiSettings(validateAiSettings(settings))
    const nextLimits = getHistoryLimits()
    if (nextLimits.maxThreads !== previousLimits.maxThreads ||
      nextLimits.maxMessages !== previousLimits.maxMessages) {
      await pruneAllAiHistoryStores(nextLimits)
    }
  })

  ipcMain.handle('settings:switchAiModel', async (_event, providerId: string, model: string) => {
    await ensureSettingsReady()
    if (typeof providerId !== 'string' || typeof model !== 'string') {
      throw new Error('Invalid provider id or model')
    }
    return await settingsStore.switchAiModel(providerId, model)
  })

  ipcMain.handle('ai:listModels', (_event, provider) => listAiProviderModels(provider))

  ipcMain.handle('ai:testProvider', async (_event, provider: any) => {
    await testAiProviderConfig(provider)
    return { ok: true }
  })

  ipcMain.handle('ai:getSessionHistory', async (_event, sessionId: string) => {
    await ensureSettingsReady()
    const store = await readAiSessionStoreAndGc(historyIdForSession(sessionId), getHistoryLimits())
    return getActiveThread(store).messages.slice()
  })

  ipcMain.handle('ai:getSessionStore', async (_event, sessionId: string) => {
    await ensureSettingsReady()
    return await readAiSessionStoreAndGc(historyIdForSession(sessionId), getHistoryLimits())
  })

  ipcMain.handle('ai:setSessionStore', async (_event, sessionId: string, store: any) => {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid AI session id')
    }
    await ensureSettingsReady()
    const limits = getHistoryLimits()
    await writeAiSessionStore(historyIdForSession(sessionId), normalizeSessionStore(store, limits), limits)
  })

  ipcMain.handle('ai:createConversation', async (_event, sessionId: string, payload: any) => {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid AI session id')
    }
    try {
      await ensureSettingsReady()
      const store = await createNewConversationAtomic(
        historyIdForSession(sessionId),
        payload && typeof payload === 'object' ? payload : {},
        getHistoryLimits(),
      )
      return store
    } catch (err: any) {
      throw new Error(err?.message || 'Failed to create conversation')
    }
  })

  ipcMain.handle('ai:selectLocalContextFile', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    const path = result.filePaths[0]
    if (!isAiMarkdownFilePath(path)) throw new Error(t('ai.markdownOnly'))
    const info = await stat(path)
    if (!info.isFile() || info.size > AI_CONTEXT_FILE_MAX_BYTES) {
      throw new Error(t('ai.markdownSizeLimit'))
    }
    const file = { source: 'local' as const, path, content: await readFile(path, 'utf8') }
    if (!normalizeAiContextFile(file)) throw new Error(t('ai.markdownEmpty'))
    return file
  })

  ipcMain.handle('ai:checkLocalContextFile', async (_event, path: string) => {
    if (typeof path !== 'string' || path.length > 1024 || !isAiMarkdownFilePath(path) || /[\0\r\n]/.test(path)) {
      throw new Error('Invalid Markdown file path')
    }
    try {
      return (await stat(path)).isFile() ? 'available' : 'missing'
    } catch (error: any) {
      return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 'missing' : 'unavailable'
    }
  })

  ipcMain.handle('ai:setContextFile', async (_event, sessionId: string, threadId: string, file: unknown) => {
    if (typeof threadId !== 'string' || !threadId) throw new Error('Invalid AI conversation')
    await ensureSettingsReady()
    return setAiConversationContextFile(historyIdForSession(sessionId), threadId, file, getHistoryLimits())
  })

  ipcMain.handle('ai:removeContextFile', async (_event, sessionId: string, threadId: string, source: 'local' | 'ssh', path: string) => {
    if (typeof threadId !== 'string' || !threadId || (source !== 'local' && source !== 'ssh') || typeof path !== 'string') throw new Error('Invalid AI context file')
    await ensureSettingsReady()
    return removeAiConversationContextFile(historyIdForSession(sessionId), threadId, source, path, getHistoryLimits())
  })

  ipcMain.handle('ai:appendSessionHistory', async (_event, sessionId: string, record: any, threadId?: string) => {
    await ensureSettingsReady()
    await upsertAiHistoryRecord(
      historyIdForSession(sessionId),
      record,
      typeof threadId === 'string' ? threadId : undefined,
      getHistoryLimits(),
    )
  })

  ipcMain.handle('ai:clearSessionHistory', async (_event, sessionId: string) => {
    await ensureSettingsReady()
    await writeAiHistoryRecords(historyIdForSession(sessionId), [], getHistoryLimits())
  })

  ipcMain.handle('ai:chat', async (_event, messages: any) => {
    await ensureSettingsReady()
    return runAiChatCompletion(settingsStore.getAiResolvedConfig(), messages)
  })

  ipcMain.handle('ai:chatStream', async (event, requestId: string, messages: any, opts: AiChatStreamOptions) => {
    if (!opts || typeof opts.sessionId !== 'string' || !opts.sessionId ||
      typeof opts.threadId !== 'string' || !opts.threadId ||
      typeof opts.assistantMessageId !== 'string' || !opts.assistantMessageId ||
      typeof opts.createdAt !== 'number' || !Number.isFinite(opts.createdAt)) {
      throw new Error('Invalid AI history target')
    }
    const target = { ...opts }
    const historyId = historyIdForSession(target.sessionId)
    if (runningHistories.has(historyId)) throw new Error('An AI reply is already running for this SSH host')
    const ownerId = event.sender.id
    const ownerWindow = BrowserWindow.fromWebContents(event.sender)
    const control = createAiStreamControl(requestId, ownerId)
    event.sender.once('destroyed', () => abortAiChatStream(requestId, ownerId))
    runningHistories.add(historyId)
    const publisher = createStreamPublisher((payload) => {
      if (!event.sender.isDestroyed()) event.sender.send(`ai:chatStream:${requestId}`, payload)
    })
    try {
      return await runPersistedAiReply({
        target,
        save: (record) => upsertAiHistoryRecord(
          historyId,
          record,
          target.threadId,
          getHistoryLimits(),
        ),
        publish: publisher.publish,
        run: async (emit, checkpoint) => {
          control.controller.signal.throwIfAborted()
          await ensureSettingsReady()
          const settings = settingsStore.getAiResolvedConfig()
          if (!settings.apiKey.trim()) throw new Error(t('ai.apiKeyRequired'))
          const limits = getHistoryLimits()
          const store = await readAiSessionStore(historyId, limits)
          const thread = store.threads.find(item => item.id === target.threadId)
          const historyMessages = thread
            ? flattenConversationForApi(thread.messages)
            : messages
          return runAiChatStream({
            emit, checkpoint, requestId, messages: historyMessages, abortController: control.controller,
            sessionId: target.sessionId,
            cwd: typeof target.cwd === 'string' ? target.cwd : undefined,
            settings, sshMcpRuntime,
            contextFiles: thread?.contextFiles,
            getToolPermission: () => settingsStore.getAiResolvedConfig().toolPermission,
            onToolApprovalRequested: ({ sessionId, toolName }) => {
              if (!settingsStore.getAiSettings().approvalNotifications) return
              return showAiApprovalNotification(ownerWindow, { sessionId, toolName })
            },
            ...(thread ? {
              contextHistory: {
                records: thread.messages,
                checkpoint: thread.contextCheckpoint,
                saveCheckpoint: (next: AiContextCheckpoint) =>
                  writeAiContextCheckpoint(
                    historyId,
                    target.threadId,
                    next,
                    limits,
                  ),
              },
            } : {}),
          })
        },
      })
    } finally {
      publisher.flush()
      control.cleanup()
      runningHistories.delete(historyId)
    }
  })

  ipcMain.handle('ai:abortChatStream', async (event, requestId: string) => {
    return abortAiChatStream(requestId, event.sender.id)
  })

  ipcMain.handle(
    'ai:resolveToolApproval',
    async (event, requestId: string, callId: string, approved: boolean) => {
      return resolveToolApproval(requestId, callId, approved, event.sender.id)
    },
  )

}
