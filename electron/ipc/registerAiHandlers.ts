import { ipcMain, app } from 'electron'
import { existsSync } from 'fs'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { SettingsStore } from '../store/settingsStore'
import { t } from '../i18n'

type AiChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

function normalizeAiBaseUrl(baseUrl: string): string {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new Error('Invalid AI base URL')
  }

  let parsed: URL
  try {
    parsed = new URL(baseUrl.trim())
  } catch {
    throw new Error('Invalid AI base URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AI base URL must use http or https')
  }

  return parsed.toString().replace(/\/$/, '')
}

function getAiChatCompletionsUrl(baseUrl: string): string {
  const normalized = normalizeAiBaseUrl(baseUrl)
  if (normalized.endsWith('/chat/completions')) return normalized
  return `${normalized}/chat/completions`
}

async function testAiProviderConfig(provider: any): Promise<void> {
  if (!provider || typeof provider !== 'object') throw new Error('Invalid AI provider')
  const baseUrl = normalizeAiBaseUrl(provider.baseUrl)
  const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey.trim() : ''
  const model = typeof provider.model === 'string' ? provider.model.trim() : ''
  if (!apiKey) throw new Error('AI API key is required')
  if (!model) throw new Error('AI model is required')

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(getAiChatCompletionsUrl(baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    })
    if (response.ok) return
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 300)
    throw new Error(`AI provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  } catch (err: any) {
    if (err?.name === 'AbortError') throw new Error('AI provider connection timed out')
    throw err
  } finally {
    clearTimeout(timeout)
  }
}

function clampTemperature(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (Number.isNaN(n)) return 0.7
  return Math.max(0, Math.min(2, Math.round(n * 100) / 100))
}

function validateAiSettings(settings: any): {
  providers: any[]
  activeProviderId: string | null
  activeModel: string
  systemPrompt: string
  temperature: number
} {
  if (!settings || typeof settings !== 'object') {
    throw new Error('Invalid AI settings')
  }
  const rawProviders = Array.isArray(settings.providers) ? settings.providers : []
  const providers = rawProviders.map((p: any, i: number) => {
    if (!p || typeof p !== 'object') throw new Error(`Invalid AI provider at index ${i}`)
    const baseUrl = normalizeAiBaseUrl(p.baseUrl)
    return {
      id: typeof p.id === 'string' && p.id ? p.id : `provider-${Date.now()}-${i}`,
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : t('common.unnamedProvider'),
      baseUrl,
      apiKey: typeof p.apiKey === 'string' ? p.apiKey : '',
      models: Array.isArray(p.models)
        ? p.models.filter((m: any) => typeof m === 'string' && m.trim()).map((m: string) => m.trim())
        : [],
    }
  })
  return {
    providers,
    activeProviderId: typeof settings.activeProviderId === 'string' ? settings.activeProviderId : (providers[0]?.id ?? null),
    activeModel: typeof settings.activeModel === 'string' ? settings.activeModel.trim() : '',
    systemPrompt: typeof settings.systemPrompt === 'string' ? settings.systemPrompt : '',
    temperature: clampTemperature(settings.temperature),
  }
}

function validateAiMessages(messages: any): AiChatMessage[] {
  if (!Array.isArray(messages)) throw new Error('Invalid AI messages')
  const validRoles = new Set(['system', 'user', 'assistant'])
  return messages.slice(-20).map((message) => {
    if (!message || typeof message !== 'object') throw new Error('Invalid AI message')
    if (!validRoles.has(message.role)) throw new Error('Invalid AI message role')
    if (typeof message.content !== 'string' || !message.content.trim()) {
      throw new Error('Invalid AI message content')
    }
    return {
      role: message.role,
      content: message.content.slice(0, 12000),
    }
  })
}

function getFirstString(...values: any[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value
  }
  return ''
}

function normalizeAiContent(content: any): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object') {
        return getFirstString(part.text, part.content)
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

function extractAiUsage(usage: any): {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
} | undefined {
  if (!usage || typeof usage !== 'object') return undefined
  const result = {
    promptTokens: typeof usage.prompt_tokens === 'number' ? usage.prompt_tokens : undefined,
    completionTokens: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : undefined,
    totalTokens: typeof usage.total_tokens === 'number' ? usage.total_tokens : undefined,
    reasoningTokens: typeof usage.completion_tokens_details?.reasoning_tokens === 'number'
      ? usage.completion_tokens_details.reasoning_tokens
      : typeof usage.reasoning_tokens === 'number'
        ? usage.reasoning_tokens
        : undefined,
  }
  if (Object.values(result).every((value) => value === undefined)) return undefined
  return result
}

type AiHistoryRecord = {
  id: string
  role: 'user' | 'assistant'
  content: string
  reasoningContent?: string
  usage?: ReturnType<typeof extractAiUsage>
  error?: boolean
  createdAt: number
}

type AiConversationThread = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: AiHistoryRecord[]
}

type AiSessionStore = {
  version: 1
  activeThreadId: string
  threads: AiConversationThread[]
}

function getAiHistoryPath(sessionId: string): string {
  if (!sessionId || typeof sessionId !== 'string') {
    throw new Error('Invalid AI session id')
  }
  const safeId = encodeURIComponent(sessionId).replace(/[()]/g, '')
  return join(app.getPath('userData'), 'ai-history', `${safeId}.jsonl`)
}

function getAiHistoryDir(): string {
  return join(app.getPath('userData'), 'ai-history')
}

function createThreadId(): string {
  return `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function titleFromMessages(messages: AiHistoryRecord[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim())
  if (!firstUser) return ''
  return firstUser.content.replace(/\s+/g, ' ').trim().slice(0, 80)
}

function createEmptyThread(now = Date.now()): AiConversationThread {
  return {
    id: createThreadId(),
    title: '',
    createdAt: now,
    updatedAt: now,
    messages: [],
  }
}

function createEmptyStore(): AiSessionStore {
  const thread = createEmptyThread()
  return {
    version: 1,
    activeThreadId: thread.id,
    threads: [thread],
  }
}

function normalizeAiHistoryRecord(record: any): AiHistoryRecord {
  if (!record || typeof record !== 'object') {
    throw new Error('Invalid AI history record')
  }
  if (record.role !== 'user' && record.role !== 'assistant') {
    throw new Error('Invalid AI history role')
  }
  if (typeof record.content !== 'string') {
    throw new Error('Invalid AI history content')
  }
  return {
    id: typeof record.id === 'string' && record.id ? record.id : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: record.role,
    content: record.content.slice(0, 200000),
    reasoningContent: typeof record.reasoningContent === 'string' ? record.reasoningContent.slice(0, 200000) : undefined,
    usage: extractAiUsage({
      prompt_tokens: record.usage?.promptTokens,
      completion_tokens: record.usage?.completionTokens,
      total_tokens: record.usage?.totalTokens,
      reasoning_tokens: record.usage?.reasoningTokens,
    }),
    error: record.error === true,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
  }
}

function normalizeThread(raw: any): AiConversationThread | null {
  if (!raw || typeof raw !== 'object') return null
  const messages = Array.isArray(raw.messages)
    ? raw.messages
        .map((item: any) => {
          try {
            return normalizeAiHistoryRecord(item)
          } catch {
            return null
          }
        })
        .filter((item: AiHistoryRecord | null): item is AiHistoryRecord => Boolean(item))
        .sort((a: AiHistoryRecord, b: AiHistoryRecord) => a.createdAt - b.createdAt)
    : []
  const createdAt = typeof raw.createdAt === 'number' ? raw.createdAt : messages[0]?.createdAt || Date.now()
  const updatedAt =
    typeof raw.updatedAt === 'number'
      ? raw.updatedAt
      : messages[messages.length - 1]?.createdAt || createdAt
  const title =
    typeof raw.title === 'string' && raw.title.trim()
      ? raw.title.trim().slice(0, 80)
      : titleFromMessages(messages)
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createThreadId(),
    title,
    createdAt,
    updatedAt,
    messages,
  }
}

function normalizeSessionStore(raw: any): AiSessionStore {
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || !Array.isArray(raw.threads)) {
    return createEmptyStore()
  }
  const threads = raw.threads
    .map((thread: any) => normalizeThread(thread))
    .filter((thread: AiConversationThread | null): thread is AiConversationThread => Boolean(thread))
  if (threads.length === 0) return createEmptyStore()
  const activeThreadId =
    typeof raw.activeThreadId === 'string' && threads.some((t: AiConversationThread) => t.id === raw.activeThreadId)
      ? raw.activeThreadId
      : threads[0].id
  return {
    version: 1,
    activeThreadId,
    threads,
  }
}

/** Parse JSONL; tolerate multi-line / broken records by brace-scanning objects. */
function parseJsonlObjects(text: string): any[] {
  const records: any[] = []
  let i = 0
  const s = text
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (i >= s.length) break
    if (s[i] !== '{') {
      const n = s.indexOf('\n{', i)
      if (n < 0) break
      i = n + 1
      continue
    }
    let depth = 0
    let inStr = false
    let esc = false
    const start = i
    for (; i < s.length; i++) {
      const c = s[i]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') {
        inStr = true
        continue
      }
      if (c === '{') depth++
      else if (c === '}') {
        depth--
        if (depth === 0) {
          i++
          try {
            records.push(JSON.parse(s.slice(start, i)))
          } catch {
            /* skip bad object */
          }
          break
        }
      }
    }
    if (depth !== 0) break
  }
  return records
}

function parseLegacyMessageRecords(data: string): AiHistoryRecord[] {
  const lineRecords = data
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return normalizeAiHistoryRecord(JSON.parse(line))
      } catch {
        return null
      }
    })
    .filter((record): record is AiHistoryRecord => Boolean(record))

  if (lineRecords.length > 0) {
    const byId = new Map<string, AiHistoryRecord>()
    for (const r of lineRecords) byId.set(r.id, r)
    return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)
  }

  const robust = parseJsonlObjects(data)
    .map((obj) => {
      try {
        return normalizeAiHistoryRecord(obj)
      } catch {
        return null
      }
    })
    .filter((record): record is AiHistoryRecord => Boolean(record))
  const byId = new Map<string, AiHistoryRecord>()
  for (const r of robust) byId.set(r.id, r)
  return Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt)
}

function storeFromLegacyMessages(messages: AiHistoryRecord[]): AiSessionStore {
  if (messages.length === 0) return createEmptyStore()
  const now = Date.now()
  const thread: AiConversationThread = {
    id: createThreadId(),
    title: titleFromMessages(messages),
    createdAt: messages[0]?.createdAt || now,
    updatedAt: messages[messages.length - 1]?.createdAt || now,
    messages,
  }
  return {
    version: 1,
    activeThreadId: thread.id,
    threads: [thread],
  }
}

async function readAiSessionStore(sessionId: string): Promise<AiSessionStore> {
  const historyPath = getAiHistoryPath(sessionId)
  if (!existsSync(historyPath)) return createEmptyStore()
  const data = await readFile(historyPath, 'utf-8')
  const trimmed = data.trim()
  if (!trimmed) return createEmptyStore()

  try {
    const parsed = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object' && parsed.version === 1 && Array.isArray(parsed.threads)) {
      return normalizeSessionStore(parsed)
    }
    // Single legacy message object
    if (parsed && typeof parsed === 'object' && (parsed.role === 'user' || parsed.role === 'assistant')) {
      return storeFromLegacyMessages([normalizeAiHistoryRecord(parsed)])
    }
  } catch {
    // fall through to JSONL migration
  }

  return storeFromLegacyMessages(parseLegacyMessageRecords(data))
}

async function writeAiSessionStore(sessionId: string, store: AiSessionStore): Promise<void> {
  const historyPath = getAiHistoryPath(sessionId)
  await mkdir(getAiHistoryDir(), { recursive: true })
  const normalized = normalizeSessionStore(store)
  await writeFile(historyPath, JSON.stringify(normalized, null, 0), 'utf-8')
}

function getActiveThread(store: AiSessionStore): AiConversationThread {
  return store.threads.find((t) => t.id === store.activeThreadId) || store.threads[0]
}

async function readAiHistoryRecords(sessionId: string): Promise<AiHistoryRecord[]> {
  const store = await readAiSessionStore(sessionId)
  return getActiveThread(store).messages.slice()
}

async function writeAiHistoryRecords(sessionId: string, records: AiHistoryRecord[]): Promise<void> {
  const store = await readAiSessionStore(sessionId)
  const active = getActiveThread(store)
  active.messages = records.map((r) => normalizeAiHistoryRecord(r)).sort((a, b) => a.createdAt - b.createdAt)
  active.title = titleFromMessages(active.messages) || active.title
  active.updatedAt = Date.now()
  await writeAiSessionStore(sessionId, store)
}

async function upsertAiHistoryRecord(sessionId: string, record: any): Promise<void> {
  const next = normalizeAiHistoryRecord(record)
  const store = await readAiSessionStore(sessionId)
  const active = getActiveThread(store)
  const idx = active.messages.findIndex((r) => r.id === next.id)
  if (idx >= 0) active.messages[idx] = next
  else active.messages.push(next)
  active.messages.sort((a, b) => a.createdAt - b.createdAt)
  active.title = titleFromMessages(active.messages) || active.title
  active.updatedAt = Date.now()
  await writeAiSessionStore(sessionId, store)
}

function extractAiReasoningFromMessage(message: any): string {
  return getFirstString(
    message?.reasoning_content,
    message?.reasoning,
    message?.thinking
  )
}

function extractAiReasoningFromChoice(choice: any): string {
  return getFirstString(
    extractAiReasoningFromMessage(choice?.delta),
    extractAiReasoningFromMessage(choice?.message),
    choice?.reasoning_content,
    choice?.reasoning,
    choice?.thinking
  )
}

async function readAiStream(response: Response, onEvent: (event: any) => void): Promise<void> {
  if (!response.body) throw new Error(t('ai.noStreamBody'))
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split(/\r?\n\r?\n/)
    buffer = events.pop() || ''

    for (const event of events) {
      const dataLines = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
      if (dataLines.length === 0) continue
      const payload = dataLines.join('\n')
      if (payload === '[DONE]') return
      try {
        onEvent(JSON.parse(payload))
      } catch {}
    }
  }
}

const activeAiStreams = new Map<string, AbortController>()

export function registerAiHandlers(settingsStore: SettingsStore): void {
  const ensureSettingsReady = () => settingsStore.init()

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
    return await readAiHistoryRecords(sessionId)
  })

  ipcMain.handle('ai:getSessionStore', async (_event, sessionId: string) => {
    return await readAiSessionStore(sessionId)
  })

  ipcMain.handle('ai:setSessionStore', async (_event, sessionId: string, store: any) => {
    if (!sessionId || typeof sessionId !== 'string') {
      throw new Error('Invalid AI session id')
    }
    await writeAiSessionStore(sessionId, normalizeSessionStore(store))
  })

  ipcMain.handle('ai:appendSessionHistory', async (_event, sessionId: string, record: any) => {
    // Upsert by id so streaming checkpoints update the same assistant message
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

    const response = await fetch(getAiChatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: settings.temperature ?? 0.7,
        messages: [
          ...(settings.systemPrompt.trim() ? [{ role: 'system', content: settings.systemPrompt.trim() }] : []),
          ...chatMessages.filter((message) => message.role !== 'system'),
        ],
      }),
    })

    if (!response.ok) {
      let message = t('ai.requestFailed', { status: response.status })
      try {
        const data = await response.json()
        message = data?.error?.message || data?.message || message
      } catch {}
      throw new Error(message)
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
      data?.reasoning
    )
    return {
      content,
      reasoningContent: reasoningContent || undefined,
      usage: extractAiUsage(data?.usage),
    }
  })

  ipcMain.handle('ai:chatStream', async (event, requestId: string, messages: any) => {
    if (!requestId || typeof requestId !== 'string') {
      throw new Error('Invalid AI request id')
    }
    await ensureSettingsReady()
    const settings = settingsStore.getAiResolvedConfig()
    const chatMessages = validateAiMessages(messages)
    if (!settings.apiKey.trim()) {
      throw new Error(t('ai.apiKeyRequired'))
    }

    const send = (payload: any) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send(`ai:chatStream:${requestId}`, payload)
      }
    }

    const createBody = (includeUsage: boolean) => ({
        model: settings.model,
        temperature: settings.temperature ?? 0.7,
        messages: [
          ...(settings.systemPrompt.trim() ? [{ role: 'system', content: settings.systemPrompt.trim() }] : []),
          ...chatMessages.filter((message) => message.role !== 'system'),
        ],
        stream: true,
        ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
      })

    const abortController = new AbortController()
    activeAiStreams.set(requestId, abortController)
    const cleanupStream = () => {
      activeAiStreams.delete(requestId)
    }

    const requestStream = (includeUsage: boolean) => fetch(getAiChatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(createBody(includeUsage)),
      signal: abortController.signal,
    })

    try {
      let response = await requestStream(true)
      if (!response.ok) {
        response = await requestStream(false)
      }

      if (!response.ok) {
        let message = `AI request failed (${response.status})`
        try {
          const data = await response.json()
          message = data?.error?.message || data?.message || message
        } catch {}
        throw new Error(message)
      }

      let content = ''
      let reasoningContent = ''
      let usage: ReturnType<typeof extractAiUsage> | undefined

      await readAiStream(response, (chunk) => {
        if (abortController.signal.aborted) return
        const choice = chunk?.choices?.[0]
        const delta = choice?.delta || {}
        const contentDelta = normalizeAiContent(delta.content ?? choice?.text)
        const reasoningDelta = extractAiReasoningFromChoice(choice)
        const chunkUsage = extractAiUsage(chunk?.usage)

        if (reasoningDelta) {
          reasoningContent += reasoningDelta
          send({ type: 'reasoning', value: reasoningDelta })
        }
        if (contentDelta) {
          content += contentDelta
          send({ type: 'content', value: contentDelta })
        }
        if (chunkUsage) {
          usage = chunkUsage
          send({ type: 'usage', value: chunkUsage })
        }
      })

      if (abortController.signal.aborted) {
        send({ type: 'done' })
        return {
          content,
          reasoningContent: reasoningContent || undefined,
          usage,
          aborted: true,
        }
      }

      send({ type: 'done' })
      return {
        content,
        reasoningContent: reasoningContent || undefined,
        usage,
      }
    } catch (err: any) {
      if (abortController.signal.aborted || err?.name === 'AbortError') {
        send({ type: 'done' })
        return { content: '', aborted: true }
      }
      throw err
    } finally {
      cleanupStream()
    }
  })

  ipcMain.handle('ai:abortChatStream', async (_event, requestId: string) => {
    if (!requestId || typeof requestId !== 'string') return false
    const controller = activeAiStreams.get(requestId)
    if (!controller) return false
    controller.abort()
    activeAiStreams.delete(requestId)
    return true
  })
}
