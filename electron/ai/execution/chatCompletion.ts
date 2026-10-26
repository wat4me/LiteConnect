import type { AiResolvedConfig } from '../../../shared/types/ai'
import { assertAiImageCapability } from '../../../shared/aiImages'
import { isContextLengthError, resolveContextWindowTokens } from '../../../shared/aiContext'
import { t } from '../../i18n/index'
import { readHttpErrorMessage } from '../providers/http'
import { getAiProviderAdapter } from '../providers/registry'
import { packRequestMessages } from './requestContext'
import { resolveAiContextBudget } from '../../../shared/aiContextPressure'
import { validateAiMessages } from '../../../shared/aiMessages'

export async function runAiChatCompletion(
  settings: AiResolvedConfig,
  messages: unknown,
  signal?: AbortSignal,
  extraSystem?: string,
  systemMaxTokens?: number,
  requiredContext?: string,
) {
  const provider = getAiProviderAdapter(settings.protocol)
  const chatMessages = validateAiMessages(messages, t)
  assertAiImageCapability(chatMessages, settings.supportsImages, t)
  if (!settings.apiKey.trim()) {
    throw new Error(t('ai.apiKeyRequired'))
  }

  const postChat = (packed: ReturnType<typeof packRequestMessages>) => {
    const request = provider.buildRequest(settings, packed, { maxTokens: resolveAiContextBudget(settings).outputReserveTokens })
    return fetch(request.url, {
      method: 'POST',
      signal,
      headers: request.headers,
      body: request.body,
    })
  }

  const assertFixedContext = (packed: ReturnType<typeof packRequestMessages>) => {
    if (requiredContext && !packed[0]?.content.includes(requiredContext)) {
      throw new Error('Fixed context file is too large for the selected model context window')
    }
  }
  let packed = packRequestMessages(settings, chatMessages, undefined, extraSystem, systemMaxTokens)
  assertFixedContext(packed)
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
      extraSystem,
      systemMaxTokens,
    )
    assertFixedContext(packed)
    response = await postChat(packed)
    if (!response.ok) {
      throw new Error(await readHttpErrorMessage(response, message))
    }
  }

  const data = await response.json()
  const reply = provider.parseResponse(settings, data)
  if (['length', 'max_tokens', 'content_filter'].includes(reply.finishReason || '')) {
    throw new Error(t('ai.responseIncomplete'))
  }
  const { content } = reply
  if (!content) {
    throw new Error(t('ai.noMessageContent'))
  }
  return {
    content,
    reasoningContent: reply.reasoningContent,
    usage: reply.usage,
    ...('apiMessages' in reply ? { apiMessages: reply.apiMessages } : {}),
  }
}
