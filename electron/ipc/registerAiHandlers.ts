import { BrowserWindow, dialog } from 'electron'
import { ServiceIpcScope } from './serviceScope'
import { workspaceScopes, workspaceHistoryId } from '../ai/workspace/workspaceScopes'
import type { AiExecutionService } from '../ai/execution/executionService'
import { readFile, stat, writeFile } from 'fs/promises'
import { SettingsStore } from '../store/settingsStore'
import { t } from '../i18n'
import { listAiProviderModels, testAiProviderConfig } from '../ai/providers/providerService'
import { validateAiSettings } from '../ai/settingsValidation'
import {
  createNewConversationAtomic,
  getActiveThread,
  normalizeAiContextFile,
  pruneAllAiHistoryStores,
  previewAiHistoryPrune,
  readAiSessionStoreAndGc,
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
import { KNOWLEDGE_MAX_BYTES, formatKnowledgeExport, type KnowledgeRequest } from '../../shared/aiKnowledge'

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
      execution.prepareKnowledge?.(sessionId, ownerId)
      return workspaceHistoryId(sessionId)
    }
    if (!sessionId || typeof sessionId !== 'string') throw new Error('Invalid AI session id')
    // Ensure newly added profiles import legacy snapshots before a history write/prune.
    execution.prepareKnowledge?.(sessionId, ownerId)
    const cached = historyIdsBySession.get(sessionId)
    if (cached) return cached
    const historyId = resolveHistoryId?.(sessionId)
    if (!historyId) throw new Error('SSH host is unavailable for AI history')
    historyIdsBySession.set(sessionId, historyId)
    return historyId
  }

  scope.handle('ai:knowledge', async (event, sessionId: string, input: KnowledgeRequest) => {
    await ensureSettingsReady()
    historyIdForSession(sessionId, event.sender.id)
    return execution.knowledgeAccess(sessionId, event.sender.id).manage(input)
  })

  scope.handle('ai:exportKnowledge', async (event, sessionId: string, connectionId: string, documentId: string) => {
    await ensureSettingsReady()
    historyIdForSession(sessionId, event.sender.id)
    const result = await execution.knowledgeAccess(sessionId, event.sender.id).manage({ action: 'read', connectionId, documentId })
    const document = result.document!
    const name = document.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    const options = { defaultPath: /\.(md|markdown)$/i.test(name) ? name : `${name}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const selected = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options)
    scope.assertOpen()
    if (selected.canceled || !selected.filePath) return false
    await writeFile(selected.filePath, formatKnowledgeExport(document), 'utf8')
    return true
  })

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

  scope.handle('ai:importKnowledgeFile', async (event) => {
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
    if (!info.isFile() || info.size > KNOWLEDGE_MAX_BYTES) {
      throw new Error(t('ai.markdownSizeLimit'))
    }
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
