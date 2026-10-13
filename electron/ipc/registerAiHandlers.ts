import { BrowserWindow, dialog, ipcMain } from 'electron'
import { AiExecutionService } from '../ai/executionService'
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
  pruneAllAiHistoryStores,
  readAiSessionStore,
  readAiSessionStoreAndGc,
  removeAiConversationContextFile,
  setAiConversationContextFile,
  updateAiConversationMetadata,
  upsertAiHistoryRecord,
  writeAiHistoryRecords,
  writeAiContextCheckpoint,
  writeAiSessionStore,
} from '../ai/historyStore'
import type { AiChatStreamOptions } from '../../shared/types/ai'
import { runAiChatCompletion } from '../ai/chatCompletion'
import { isAiMarkdownFilePath } from '../../shared/aiFixedContext'
import { showAiApprovalNotification } from '../ai/approvalNotification'
import { hydrateAiImages } from '../ai/imageStore'
import { listAiWorkspaceConversations } from '../ai/workspaceConversations'
import { AI_WORKSPACE_HISTORY_LIMIT } from '../../shared/aiWorkspaceConversations'

export function registerAiHandlers(
  settingsStore: SettingsStore,
  sshMcpRuntime?: SshMcpRuntime,
  resolveHistoryId?: (sessionId: string) => string | undefined,
): AiExecutionService {
  const ensureSettingsReady = () => settingsStore.init().then(() => settingsStore.initMigrations())
  const getHistoryLimits = () => {
    const settings = settingsStore.getAiSettings()
    return {
      maxThreads: settings.historyMaxThreads,
      maxMessages: settings.historyMaxMessages,
    }
  }
  const execution = new AiExecutionService({
    settings: { ready: ensureSettingsReady, config: () => settingsStore.getAiResolvedConfig(), limits: getHistoryLimits },
    history: { read: readAiSessionStore, save: upsertAiHistoryRecord, checkpoint: writeAiContextCheckpoint, hydrate: hydrateAiImages },
    runtime: sshMcpRuntime,
    onError: error => console.warn('Could not deliver AI background results', error),
  })
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

  ipcMain.handle('ai:setSessionStore', async (event, sessionId: string, store: any) => {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid AI session id')
    }
    await ensureSettingsReady()
    const limits = getHistoryLimits()
    await writeAiSessionStore(historyIdForSession(sessionId), store, limits)
    execution.selectConversation(event.sender.id, sessionId, store.activeThreadId)
  })

  ipcMain.handle('ai:suppressBackgroundReplies', async (event, sessionId: string, threadId: string) => {
    historyIdForSession(sessionId)
    if (typeof threadId !== 'string' || !threadId) throw new Error('Invalid AI thread id')
    await execution.suppressBackground(event.sender.id, sessionId, threadId)
  })
  ipcMain.handle('ai:createConversation', async (event, sessionId: string, payload: any) => {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid AI session id')
    }
    try {
      await ensureSettingsReady()
      if (typeof payload?.threadId === 'string') await execution.suppressBackground(event.sender.id, sessionId, payload.threadId)
      const store = await createNewConversationAtomic(
        historyIdForSession(sessionId),
        payload && typeof payload === 'object' ? payload : {},
        getHistoryLimits(),
      )
      execution.selectConversation(event.sender.id, sessionId, store.activeThreadId)
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

  ipcMain.handle('ai:readLocalContextFile', async (_event, sessionId: string, threadId: string, path: string) => {
    if (typeof path !== 'string' || path.length > 1024 || !isAiMarkdownFilePath(path) || /[\0\r\n]/.test(path)) {
      throw new Error('Invalid Markdown file path')
    }
    await ensureSettingsReady()
    const store = await readAiSessionStore(historyIdForSession(sessionId), getHistoryLimits())
    const thread = store.threads.find(item => item.id === threadId)
    if (!thread || store.activeThreadId !== threadId || !thread.contextFiles.some(file => file.source === 'local' && file.path === path)) {
      throw new Error('AI context file is no longer attached to this conversation')
    }
    const info = await stat(path)
    if (!info.isFile() || info.size > AI_CONTEXT_FILE_MAX_BYTES) throw new Error(t('ai.markdownSizeLimit'))
    const file = { source: 'local' as const, path, content: await readFile(path, 'utf8') }
    if (!normalizeAiContextFile(file)) throw new Error(t('ai.markdownEmpty'))
    return file
  })

  ipcMain.handle('ai:updateConversation', async (_event, sessionId: string, threadId: string, patch: unknown) => {
    if (typeof threadId !== 'string' || !threadId || !patch || typeof patch !== 'object') {
      throw new Error('Invalid AI conversation update')
    }
    await ensureSettingsReady()
    return updateAiConversationMetadata(historyIdForSession(sessionId), threadId, patch, getHistoryLimits())
  })

  ipcMain.handle('ai:setContextFile', async (_event, sessionId: string, threadId: string, file: unknown) => {
    if (typeof threadId !== 'string' || !threadId) throw new Error('Invalid AI conversation')
    await ensureSettingsReady()
    return setAiConversationContextFile(historyIdForSession(sessionId), threadId, file, getHistoryLimits())
  })

  ipcMain.handle('ai:removeContextFile', async (_event, sessionId: string, threadId: string, source: 'local' | 'ssh', path: string, removeFromFuture: boolean) => {
    if (typeof threadId !== 'string' || !threadId || (source !== 'local' && source !== 'ssh') || typeof path !== 'string' || typeof removeFromFuture !== 'boolean') throw new Error('Invalid AI context file')
    await ensureSettingsReady()
    return removeAiConversationContextFile(historyIdForSession(sessionId), threadId, source, path, removeFromFuture, getHistoryLimits())
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

  ipcMain.handle('ai:chatStream', async (event, requestId: string, _messages: unknown, target: AiChatStreamOptions) => {
    const sender = event.sender
    const ownerWindow = BrowserWindow.fromWebContents(sender)
    return execution.run({
      requestId, historyId: historyIdForSession(target?.sessionId), target,
      owner: {
        id: sender.id, kind: 'interactive', isAlive: () => !sender.isDestroyed(),
        onDisposed: callback => {
          sender.once('destroyed', callback)
          return () => { sender.removeListener('destroyed', callback) }
        },
      },
    }, {
      onStream: ({ requestId: id, payload }) => {
        if (!sender.isDestroyed()) sender.send(`ai:chatStream:${id}`, payload)
      },
      onRecord: ({ trigger, requestId: id, target: destination, record }) => {
        if (trigger === 'background' && !sender.isDestroyed()) sender.send('ai:backgroundReply', {
          sessionId: destination.sessionId, threadId: destination.threadId, requestId: id, record,
        })
      },
      onApproval: ({ sessionId, toolName }) => {
        if (!settingsStore.getAiSettings().approvalNotifications) return
        return showAiApprovalNotification(ownerWindow, { sessionId, toolName })
      },
    })
  })

  ipcMain.handle('ai:abortChatStream', async (event, requestId: string) => execution.abort(event.sender.id, requestId))

  ipcMain.handle('ai:resolveToolApproval', async (event, requestId: string, callId: string, approved: boolean) =>
    execution.resolveApproval(event.sender.id, requestId, callId, approved))

  ipcMain.handle('ai:listWorkspaceConversations', (_event, hosts: unknown, limit?: unknown) => {
    if (!Array.isArray(hosts)) return []
    const refs = hosts.flatMap((item: any) => {
      if (!item || typeof item.id !== 'string' || !item.id || typeof item.host !== 'string' || !item.host) return []
      return [{ id: item.id, name: typeof item.name === 'string' ? item.name : item.host, host: item.host, port: Number(item.port) || 22 }]
    })
    const capped = typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? Math.min(50, limit) : AI_WORKSPACE_HISTORY_LIMIT
    return listAiWorkspaceConversations(refs, capped)
  })

  return execution
}
