import { ipcMain } from 'electron'
import { SettingsStore } from '../store/settingsStore'
import { t } from '../i18n'
import {
  isContextLengthError,
  resolveContextWindowTokens,
} from '../../shared/aiContext'
import type { SshMcpRuntime } from '../mcp/runtime'
import {
  extractAiUsage,
  getAiChatCompletionsUrl,
  getFirstString,
  normalizeAiContent,
  packRequestMessages,
  readHttpErrorMessage,
  testAiProviderConfig,
  validateAiMessages,
  validateAiSettings,
} from '../ai/providerHttp'
import {
  createNewConversationAtomic,
  getActiveThread,
  normalizeSessionStore,
  readAiSessionStoreAndGc,
  setThreadGeneratedTitle,
  upsertAiHistoryRecord,
  writeAiHistoryRecords,
  writeAiSessionStore,
} from '../ai/historyStore'
import { abortAiChatStream, resolveToolApproval, runAiChatStream } from '../ai/chatStream'
import { generateConversationTitle } from '../ai/conversationTitle'

export function registerAiHandlers(settingsStore: SettingsStore, sshMcpRuntime?: SshMcpRuntime): void {
  const ensureSettingsReady = () => settingsStore.init().then(() => settingsStore.initMigrations())

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

  ipcMain.handle(
    'ai:setThreadTitle',
    async (_event, sessionId: string, threadId: string, title: string) => {
      if (!sessionId || typeof sessionId !== 'string') return { ok: false }
      if (!threadId || typeof threadId !== 'string') return { ok: false }
      if (typeof title !== 'string') return { ok: false }
      try {
        const ok = await setThreadGeneratedTitle(sessionId, threadId, title)
        return { ok }
      } catch {
        return { ok: false }
      }
    },
  )

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

  ipcMain.handle('ai:appendSessionHistory', async (_event, sessionId: string, record: any) => {
    await upsertAiHistoryRecord(sessionId, record)
  })

  ipcMain.handle('ai:clearSessionHistory', async (_event, sessionId: string) => {
    await writeAiHistoryRecords(sessionId, [])
  })

  ipcMain.handle('ai:chat', async (_event, messages: any) => {
    await ensureSettingsReady()
    const settings = settingsStore.getAiResolvedConfig()
    const chatMessages = validateAiMessages(messages)
    if (!settings.apiKey.trim()) {
      throw new Error(t('ai.apiKeyRequired'))
    }

    const postChat = (packed: ReturnType<typeof packRequestMessages>) =>
      fetch(getAiChatCompletionsUrl(settings.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${settings.apiKey}`,
        },
        body: JSON.stringify({
          model: settings.model,
          temperature: settings.temperature ?? 0.7,
          messages: packed,
        }),
      })

    let packed = packRequestMessages(settings, chatMessages)
    let response = await postChat(packed)
    if (!response.ok) {
      const message = await readHttpErrorMessage(
        response,
        t('ai.requestFailed', { status: response.status }),
      )
      if (!isContextLengthError(message)) throw new Error(message)
      packed = packRequestMessages(
        settings,
        chatMessages,
        Math.max(4_096, Math.floor(resolveContextWindowTokens(settings.model, settings.contextWindowTokens) / 2)),
      )
      response = await postChat(packed)
      if (!response.ok) {
        throw new Error(await readHttpErrorMessage(response, message))
      }
    }

    const data = await response.json()
    const choice = data?.choices?.[0]
    const message = choice?.message || {}
    const content = normalizeAiContent(message.content ?? choice?.text)
    if (!content) {
      throw new Error(t('ai.noMessageContent'))
    }
    const reasoningContent = getFirstString(
      message.reasoning_content,
      message.reasoning,
      message.thinking,
      choice?.reasoning_content,
      choice?.reasoning,
      choice?.thinking,
      data?.reasoning_content,
      data?.reasoning,
    )
    return {
      content,
      reasoningContent: reasoningContent || undefined,
      usage: extractAiUsage(data?.usage),
    }
  })

  ipcMain.handle('ai:chatStream', async (event, requestId: string, messages: any, opts?: { sessionId?: string }) => {
    await ensureSettingsReady()
    const settings = settingsStore.getAiResolvedConfig()
    if (!settings.apiKey.trim()) {
      throw new Error(t('ai.apiKeyRequired'))
    }
    return runAiChatStream({
      event,
      requestId,
      messages,
      sessionId: opts?.sessionId,
      settings,
      sshMcpRuntime,
    })
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

  ipcMain.handle('ai:generateConversationTitle', async (_event, payload: any) => {
    try {
      await ensureSettingsReady()
      const settings = settingsStore.getAiResolvedConfig()
      return await generateConversationTitle({
        settings,
        userText: typeof payload?.userText === 'string' ? payload.userText : '',
        assistantText: typeof payload?.assistantText === 'string' ? payload.assistantText : '',
        sessionId: typeof payload?.sessionId === 'string' ? payload.sessionId : '',
        threadId: typeof payload?.threadId === 'string' ? payload.threadId : '',
      })
    } catch {
      return { title: '' }
    }
  })
}
