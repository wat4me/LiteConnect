import type { AiProviderProtocol } from './types/ai'

export function normalizeAiProviderProtocol(value: unknown): AiProviderProtocol {
  if (value == null || value === '' || value === 'openai') return 'openai'
  if (value === 'anthropic') return 'anthropic'
  throw new Error('Unsupported AI provider protocol')
}

export function defaultAiProviderBaseUrl(protocol: AiProviderProtocol): string {
  return protocol === 'anthropic' ? 'https://api.anthropic.com/v1' : 'https://api.openai.com/v1'
}
