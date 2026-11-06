import type { AiResolvedConfig } from '../../../shared/types/ai'
import { assertAiImageCapability } from '../../../shared/aiImages'
import { isContextLengthError, isOutputLimitError, MIN_OUTPUT_RESERVE_TOKENS, resolveContextWindowTokens } from '../../../shared/aiContext'
import { t } from '../../i18n/index'
import { AiProviderError, fetchAiResponse, readAiResponseJson, readHttpErrorMessage } from '../providers/http'
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
) {
  const provider = getAiProviderAdapter(settings.protocol)
  const chatMessages = validateAiMessages(messages, t)
  assertAiImageCapability(chatMessages, settings.supportsImages, t)
  if (!settings.apiKey.trim()) {
    throw new Error(t('ai.apiKeyRequired'))
  }

  // A provider may cap output lower than the model advertises; a retry lowers this value.
  let outputCap = resolveAiContextBudget(settings).outputReserveTokens
  const postChat = (packed: ReturnType<typeof packRequestMessages>) => {
    const request = provider.buildRequest(settings, packed, { maxTokens: outputCap })
    return fetchAiResponse(request.url, {
      method: 'POST',
      signal,
      headers: request.headers,
      body: request.body,
    })
  }

  let packed = packRequestMessages(settings, chatMessages, undefined, extraSystem, systemMaxTokens)

  let response = await postChat(packed)
  let failure = ''
  let shrunk = false
  for (let attempt = 0; !response.ok && attempt < 8; attempt++) {
    failure = await readHttpErrorMessage(
      response,
      t('ai.requestFailed', { status: response.status }),
    )
    if (isContextLengthError(failure) && !shrunk) {
      shrunk = true
      packed = packRequestMessages(
        settings,
        chatMessages,
        Math.max(4_096, Math.floor(resolveContextWindowTokens(settings.model, settings.contextWindowTokens) / 2)),
        extraSystem,
        systemMaxTokens,
      )
      response = await postChat(packed)
      continue
    }
    if (isOutputLimitError(failure) && outputCap > MIN_OUTPUT_RESERVE_TOKENS) {
      const reduced = Math.max(MIN_OUTPUT_RESERVE_TOKENS, Math.floor(outputCap / 2))
      if (reduced < outputCap) {
        outputCap = reduced
        response = await postChat(packed)
        continue
      }
    }
    throw new AiProviderError({ kind: 'http', status: response.status, detail: failure })
  }
  if (!response.ok) {
    const status = response.status
    throw new AiProviderError({ kind: 'http', status, detail: failure || t('ai.requestFailed', { status }) })
  }

  const data = await readAiResponseJson(response)
  const reply = provider.parseResponse(settings, data)
  if (['length', 'max_tokens'].includes(reply.finishReason || '')) {
    throw new Error(t('ai.outputLimitReached'))
  }
  if (reply.finishReason === 'content_filter') {
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
