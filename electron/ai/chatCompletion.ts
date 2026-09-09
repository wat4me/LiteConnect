import type { AiResolvedConfig } from '../../shared/types/ai'
import { isContextLengthError, resolveContextWindowTokens } from '../../shared/aiContext'
import { t } from '../i18n'
import { extractAiUsage, getAiChatCompletionsUrl, getFirstString, normalizeAiContent, packRequestMessages, readHttpErrorMessage, toApiChatMessages, validateAiMessages } from './providerHttp'

export async function runAiChatCompletion(settings: AiResolvedConfig, messages: unknown, signal?: AbortSignal) {
  const chatMessages = validateAiMessages(messages)
  if (!settings.apiKey.trim()) {
    throw new Error(t('ai.apiKeyRequired'))
  }

  const postChat = (packed: ReturnType<typeof packRequestMessages>) =>
    fetch(getAiChatCompletionsUrl(settings.baseUrl), {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        temperature: settings.temperature ?? 0.7,
        messages: toApiChatMessages(packed, false),
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
}
