import type { AiResolvedConfig } from '../../shared/types/ai'
import {
  extractTitleCandidateFromChoice,
  getAiChatCompletionsUrl,
  sanitizeGeneratedTitle,
} from './providerHttp'
import {
  abortTitleGeneration,
  clearTitleAbort,
  registerTitleAbort,
  titleGenAbortKey,
} from './titleAbort'

export async function generateConversationTitle(opts: {
  settings: AiResolvedConfig
  userText: string
  assistantText?: string
  sessionId?: string
  threadId?: string
}): Promise<{ title: string }> {
  const { settings, sessionId = '', threadId = '' } = opts
  if (!settings.apiKey.trim()) return { title: '' }

  const userText = opts.userText.trim()
  const assistantText = (opts.assistantText || '').trim()
  if (!userText) return { title: '' }

  const abortKey = sessionId && threadId ? titleGenAbortKey(sessionId, threadId) : ''
  if (abortKey) abortTitleGeneration(sessionId, threadId)

  const userSlice = userText.slice(0, 400)
  const asstSlice = assistantText.slice(0, 400)
  const context = asstSlice
    ? `用户：${userSlice}\n助手：${asstSlice}`
    : `用户：${userSlice}`

  const controller = new AbortController()
  if (abortKey) registerTitleAbort(abortKey, controller)
  const timeout = setTimeout(() => controller.abort(), 20_000)
  try {
    const response = await fetch(getAiChatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: 0.2,
        max_tokens: 128,
        stream: false,
        messages: [
          {
            role: 'user',
            content:
              '请根据下面的对话写一个简短中文标题。\n' +
              '规则：不超过16个字；不要引号/书名号/序号/「标题：」前缀；不要解释；只输出标题一行。\n\n' +
              context,
          },
        ],
      }),
      signal: controller.signal,
    })

    if (!response.ok) return { title: '' }

    const data = await response.json()
    const choice = data?.choices?.[0]
    const raw = extractTitleCandidateFromChoice(choice, data)
    const title = sanitizeGeneratedTitle(raw)
    return { title: title || '' }
  } catch {
    return { title: '' }
  } finally {
    clearTimeout(timeout)
    if (abortKey) clearTitleAbort(abortKey, controller)
  }
}
