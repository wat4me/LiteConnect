import { BrowserWindow, dialog } from 'electron'
import { ServiceIpcScope } from './serviceScope'
import { workspaceScopes, workspaceHistoryId } from '../ai/workspace/workspaceScopes'
import type { AiExecutionService } from '../ai/execution/executionService'
import { readFile, stat } from 'fs/promises'
import { SettingsStore } from '../store/settingsStore'
import { t } from '../i18n'
import { listAiProviderModels, testAiProviderConfig } from '../ai/providers/providerService'
import { validateAiSettings } from '../ai/settingsValidation'
import {
  createNewConversationAtomic,
  AI_CONTEXT_FILE_MAX_BYTES,
  getActiveThread,
  normalizeAiContextFile,
  pruneAllAiHistoryStores,
  previewAiHistoryPrune,
  readAiSessionStore,
  readAiSessionStoreAndGc,
  removeAiConversationContextFile,
  setAiConversationContextFile,
  updateAiConversationMetadata,
  upsertAiHistoryRecord,
  writeAiHistoryRecords,
  writeAiSessionStore,
} from '../ai/history/historyStore'
import type { AiChatStreamOptions } from '../../shared/types/ai'
import { runAiChatCompletion } from '../ai/execution/chatCompletion'
import { isAiMarkdownFilePath } from '../../shared/aiFixedContext'
import { showAiApprovalNotification } from './aiApprovalNotification'
import { listAiWorkspaceConversations } from '../ai/workspace/workspaceConversations'
import { AI_WORKSPACE_HISTORY_LIMIT } from '../../shared/aiWorkspaceConversations'
import { normalizeAiHistoryLimits } from '../../shared/aiHistoryLimits'

export function registerAiHandlers(
  settingsStore: SettingsStore,
  execution: AiExecutionService,
  resolveHistoryId?: (sessionId: string) => string | undefined,
  scope = new ServiceIpcScope(),
): void {
  const ensureSettingsReady = async () => {
    scope.assertOpen()
    await settingsStore.init()
    scope.assertOpen()
    await settingsStore.initMigrations()
    scope.assertOpen()
  }
  const getHistoryLimits = () => {
    const settings = settingsStore.getAiSettings()
    return {
      maxThreads: settings.historyMaxThreads,
      maxMessages: settings.historyMaxMessages,
    }
  }
  const historyIdsBySession = new Map<string, string>()

  const historyIdForSession = (sessionId: string, ownerId: number): string => {
    if (typeof sessionId === 'string' && sessionId.startsWith('workspace:')) {
      workspaceScopes.owned(sessionId, ownerId)
      return workspaceHistoryId(sessionId)
    }
    if (!sessionId || typeof sessionId !== 'string') throw new Error('Invalid AI session id')
    const cached = historyIdsBySession.get(sessionId)
    if (cached) return cached
    const historyId = resolveHistoryId?.(sessionId)
    if (!historyId) throw new Error('SSH host is unavailable for AI history')
    historyIdsBySession.set(sessionId, historyId)
    return historyId
  }

  scope.handle('ai:openWorkspaceScope', async (event, input) => {
    await ensureSettingsReady()
    const scope = workspaceScopes.open(event.sender.id, input)
    execution.selectConversation(event.sender.id, scope.id)
    return scope
  })

  scope.handle('settings:getAiSettings', async () => {
    await ensureSettingsReady()
    return settingsStore.getAiSettings()
  })

  scope.handle('ai:previewHistoryPrune', async (_event, limits: unknown) => {
    await ensureSettingsReady()
    return previewAiHistoryPrune(normalizeAiHistoryLimits(limits && typeof limits === 'object' ? limits : {}))
  })

  scope.handle('settings:setAiSettings', async (_event, settings: any) => {
    await ensureSettingsReady()
    const previousLimits = getHistoryLimits()
    await settingsStore.setAiSettings(validateAiSettings(settings))
    const nextLimits = getHistoryLimits()
    if (nextLimits.maxThreads !== previousLimits.maxThreads ||
      nextLimits.maxMessages !== previousLimits.maxMessages) {
      await pruneAllAiHistoryStores(nextLimits)
    }
  })

  scope.handle('settings:switchAiModel', async (_event, providerId: string, model: string) => {
    await ensureSettingsReady()
    if (typeof providerId !== 'string' || typeof model !== 'string') {
      throw new Error('Invalid provider id or model')
    }
    return await settingsStore.switchAiModel(providerId, model)
  })

  scope.handle('ai:listModels', (_event, provider) => listAiProviderModels(provider))

  scope.handle('ai:testProvider', async (_event, provider: any) => {
    await testAiProviderConfig(provider)
    return { ok: true }
  })

  scope.handle('ai:getSessionHistory', async (event, sessionId: string) => {
    await ensureSettingsReady()
    const store = await readAiSessionStoreAndGc(historyIdForSession(sessionId, event.sender?.id), getHistoryLimits())
    return getActiveThread(store).messages.slice()
  })

  scope.handle('ai:getSessionStore', async (event, sessionId: string) => {
    await ensureSettingsReady()
    return await readAiSessionStoreAndGc(historyIdForSession(sessionId, event.sender?.id), getHistoryLimits())
  })

  scope.handle('ai:setSessionStore', async (event, sessionId: string, store: any) => {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid AI session id')
    }
    await ensureSettingsReady()
    const limits = getHistoryLimits()
    await writeAiSessionStore(historyIdForSession(sessionId, event.sender?.id), store, limits)
    execution.selectConversation(event.sender.id, sessionId, store.activeThreadId)
  })

  scope.handle('ai:suppressBackgroundReplies', async (event, sessionId: string, threadId: string) => {
    historyIdForSession(sessionId, event.sender?.id)
    if (typeof threadId !== 'string' || !threadId) throw new Error('Invalid AI thread id')
    await execution.suppressBackground(event.sender.id, sessionId, threadId)
  })
  scope.handle('ai:createConversation', async (event, sessionId: string, payload: any) => {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid AI session id')
    }
    try {
      await ensureSettingsReady()
      if (typeof payload?.threadId === 'string') await execution.suppressBackground(event.sender.id, sessionId, payload.threadId)
      const store = await createNewConversationAtomic(
        historyIdForSession(sessionId, event.sender?.id),
        payload && typeof payload === 'object' ? payload : {},
        getHistoryLimits(),
      )
      execution.selectConversation(event.sender.id, sessionId, store.activeThreadId)
      return store
    } catch (err: any) {
      throw new Error(err?.message || 'Failed to create conversation')
    }
  })

  scope.handle('ai:selectLocalContextFile', async (event) => {
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

  scope.handle('ai:checkLocalContextFile', async (_event, path: string) => {
    if (typeof path !== 'string' || path.length > 1024 || !isAiMarkdownFilePath(path) || /[\0\r\n]/.test(path)) {
      throw new Error('Invalid Markdown file path')
    }
    try {
      return (await stat(path)).isFile() ? 'available' : 'missing'
    } catch (error: any) {
      return error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 'missing' : 'unavailable'
    }
  })

  scope.handle('ai:readLocalContextFile', async (event, sessionId: string, threadId: string, path: string) => {
    if (typeof path !== 'string' || path.length > 1024 || !isAiMarkdownFilePath(path) || /[\0\r\n]/.test(path)) {
      throw new Error('Invalid Markdown file path')
    }
    await ensureSettingsReady()
    const store = await readAiSessionStore(historyIdForSession(sessionId, event.sender?.id), getHistoryLimits())
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

  scope.handle('ai:updateConversation', async (event, sessionId: string, threadId: string, patch: unknown) => {
    if (typeof threadId !== 'string' || !threadId || !patch || typeof patch !== 'object') {
      throw new Error('Invalid AI conversation update')
    }
    await ensureSettingsReady()
    return updateAiConversationMetadata(historyIdForSession(sessionId, event.sender?.id), threadId, patch, getHistoryLimits())
  })

  scope.handle('ai:setContextFile', async (event, sessionId: string, threadId: string, file: unknown) => {
    if (typeof threadId !== 'string' || !threadId) throw new Error('Invalid AI conversation')
    await ensureSettingsReady()
    return setAiConversationContextFile(historyIdForSession(sessionId, event.sender?.id), threadId, file, getHistoryLimits())
  })

  scope.handle('ai:removeContextFile', async (event, sessionId: string, threadId: string, source: 'local' | 'ssh', path: string, removeFromFuture: boolean) => {
    if (typeof threadId !== 'string' || !threadId || (source !== 'local' && source !== 'ssh') || typeof path !== 'string' || typeof removeFromFuture !== 'boolean') throw new Error('Invalid AI context file')
    await ensureSettingsReady()
    return removeAiConversationContextFile(historyIdForSession(sessionId, event.sender?.id), threadId, source, path, removeFromFuture, getHistoryLimits())
  })

  scope.handle('ai:appendSessionHistory', async (event, sessionId: string, record: any, threadId?: string) => {
    await ensureSettingsReady()
    await upsertAiHistoryRecord(
      historyIdForSession(sessionId, event.sender?.id),
      record,
      typeof threadId === 'string' ? threadId : undefined,
      getHistoryLimits(),
    )
  })

  scope.handle('ai:clearSessionHistory', async (event, sessionId: string) => {
    await ensureSettingsReady()
    await writeAiHistoryRecords(historyIdForSession(sessionId, event.sender?.id), [], getHistoryLimits())
  })

  scope.handle('ai:chat', async (_event, messages: any) => {
    await ensureSettingsReady()
    return runAiChatCompletion(settingsStore.getAiResolvedConfig(), messages, scope.signal)
  })

  scope.handle('ai:chatStream', async (event, requestId: string, _messages: unknown, target: AiChatStreamOptions) => {
    const sender = event.sender
    const ownerWindow = BrowserWindow.fromWebContents(sender)
    return execution.run({
      requestId, historyId: historyIdForSession(target?.sessionId, sender.id), target,
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
      onRecord: ({ trigger, requestId: id, target: destination, record, passive }) => {
        if (trigger === 'background' && !sender.isDestroyed()) sender.send('ai:backgroundReply', {
          sessionId: destination.sessionId, threadId: destination.threadId, requestId: id, record,
          ...(passive ? { passive: true } : {}),
        })
      },
      onApproval: ({ sessionId, toolName }) => {
        if (!settingsStore.getAiSettings().approvalNotifications) return
        return showAiApprovalNotification(ownerWindow, { sessionId, toolName })
      },
    })
  })

  scope.handle('ai:abortChatStream', async (event, requestId: string) => execution.abort(event.sender.id, requestId))

  scope.handle('ai:resolveToolApproval', async (event, requestId: string, callId: string, approved: boolean) =>
    execution.resolveApproval(event.sender.id, requestId, callId, approved))
  scope.handle('ai:answerQuestion', async (event, requestId: string, callId: string, answer: unknown) =>
    execution.answerQuestion(event.sender.id, requestId, callId, answer))

  scope.handle('ai:listWorkspaceConversations', (_event, hosts: unknown, limit?: unknown) => {
    if (!Array.isArray(hosts)) return []
    const refs = hosts.flatMap((item: any) => {
      if (!item || typeof item.id !== 'string' || !item.id || typeof item.host !== 'string' || !item.host) return []
      return [{ id: item.id, name: typeof item.name === 'string' ? item.name : item.host, host: item.host, port: Number(item.port) || 22 }]
    })
    const capped = typeof limit === 'number' && Number.isInteger(limit) && limit > 0 ? Math.min(50, limit) : AI_WORKSPACE_HISTORY_LIMIT
    return listAiWorkspaceConversations(refs, capped)
  })

}
