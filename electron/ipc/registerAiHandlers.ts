import { ipcMain } from 'electron'
import { SettingsStore } from '../store/settingsStore'
import { t } from '../i18n'
import type { SshMcpRuntime } from '../mcp/runtime'
import { testAiProviderConfig, validateAiSettings } from '../ai/providerHttp'
import {
  createNewConversationAtomic,
  getActiveThread,
  normalizeSessionStore,
  readAiSessionStoreAndGc,
  upsertAiHistoryRecord,
  writeAiHistoryRecords,
  writeAiSessionStore,
} from '../ai/historyStore'
import { abortAiChatStream, createAiStreamControl, resolveToolApproval, runAiChatStream } from '../ai/chatStream'
import type { AiChatStreamOptions } from '../../shared/types/ai'
import { runAiChatCompletion } from '../ai/chatCompletion'
import { runPersistedAiReply } from '../ai/streamPersistence'
import { createStreamPublisher } from '../ai/streamPublisher'

export function registerAiHandlers(settingsStore: SettingsStore, sshMcpRuntime?: SshMcpRuntime): void {
  const ensureSettingsReady = () => settingsStore.init().then(() => settingsStore.initMigrations())
  const runningSessions = new Set<string>()

  ipcMain.handle('settings:getAiSettings', async () => {
    await ensureSettingsReady()
    return settingsStore.getAiSettings()
  })

  ipcMain.handle('settings:setAiSettings', async (_event, settings: any) => {
    await ensureSettingsReady()
    await settingsStore.setAiSettings(validateAiSettings(settings))
  })

  ipcMain.handle('settings:switchAiModel', async (_event, providerId: string, model: string) => {
    await ensureSettingsReady()
    if (typeof providerId !== 'string' || typeof model !== 'string') {
      throw new Error('Invalid provider id or model')
    }
    return await settingsStore.switchAiModel(providerId, model)
  })

  ipcMain.handle('ai:testProvider', async (_event, provider: any) => {
    await testAiProviderConfig(provider)
    return { ok: true }
  })

  ipcMain.handle('ai:getSessionHistory', async (_event, sessionId: string) => {
    const store = await readAiSessionStoreAndGc(sessionId)
    return getActiveThread(store).messages.slice()
  })

  ipcMain.handle('ai:getSessionStore', async (_event, sessionId: string) => {
    return await readAiSessionStoreAndGc(sessionId)
  })

  ipcMain.handle('ai:setSessionStore', async (_event, sessionId: string, store: any) => {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid AI session id')
    }
    await writeAiSessionStore(sessionId, normalizeSessionStore(store))
  })

  ipcMain.handle('ai:createConversation', async (_event, sessionId: string, payload: any) => {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid AI session id')
    }
    try {
      const store = await createNewConversationAtomic(sessionId, payload && typeof payload === 'object' ? payload : {})
      return store
    } catch (err: any) {
      throw new Error(err?.message || 'Failed to create conversation')
    }
  })

  ipcMain.handle('ai:appendSessionHistory', async (_event, sessionId: string, record: any, threadId?: string) => {
    await upsertAiHistoryRecord(sessionId, record, typeof threadId === 'string' ? threadId : undefined)
  })

  ipcMain.handle('ai:clearSessionHistory', async (_event, sessionId: string) => {
    await writeAiHistoryRecords(sessionId, [])
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
    if (runningSessions.has(target.sessionId)) throw new Error('An AI reply is already running for this session')
    const control = createAiStreamControl(requestId)
    runningSessions.add(target.sessionId)
    const publisher = createStreamPublisher((payload) => {
      if (!event.sender.isDestroyed()) event.sender.send(`ai:chatStream:${requestId}`, payload)
    })
    try {
      return await runPersistedAiReply({
        target,
        save: (record) => upsertAiHistoryRecord(target.sessionId, record, target.threadId),
        publish: publisher.publish,
        run: async (emit, checkpoint) => {
          control.controller.signal.throwIfAborted()
          await ensureSettingsReady()
          const settings = settingsStore.getAiResolvedConfig()
          if (!settings.apiKey.trim()) throw new Error(t('ai.apiKeyRequired'))
          return runAiChatStream({
            emit, checkpoint, requestId, messages, abortController: control.controller,
            sessionId: target.sessionId,
            cwd: typeof target.cwd === 'string' ? target.cwd : undefined,
            settings, sshMcpRuntime,
            getToolPermission: () => settingsStore.getAiResolvedConfig().toolPermission,
          })
        },
      })
    } finally {
      publisher.flush()
      control.cleanup()
      runningSessions.delete(target.sessionId)
    }
  })

  ipcMain.handle('ai:abortChatStream', async (_event, requestId: string) => {
    return abortAiChatStream(requestId)
  })

  ipcMain.handle(
    'ai:resolveToolApproval',
    async (_event, requestId: string, callId: string, approved: boolean) => {
      return resolveToolApproval(requestId, callId, approved)
    },
  )

}
