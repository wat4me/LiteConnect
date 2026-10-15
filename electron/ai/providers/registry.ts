import { normalizeAiProviderProtocol } from '../../../shared/aiProviderProtocol'
import type { AiProviderProtocol } from '../../../shared/types/ai'
import { anthropicProvider } from './anthropic'
import { openaiProvider } from './openai'
import type { AiProviderAdapter } from './types'

const adapters: Record<AiProviderProtocol, AiProviderAdapter> = {
  openai: openaiProvider,
  anthropic: anthropicProvider,
}

export function getAiProviderAdapter(protocol?: AiProviderProtocol): AiProviderAdapter {
  return adapters[normalizeAiProviderProtocol(protocol)]
}
