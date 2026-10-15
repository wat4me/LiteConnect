import type { AiChatMessage, AiDiscoveredModel, AiProviderProtocol, AiResolvedConfig, AiUsage } from '../../../shared/types/ai'

export type AiProviderCredentials = { baseUrl: string; apiKey: string; protocol?: AiProviderProtocol }
export type AiFunctionTool = { type: 'function'; function: { name: string; description?: string; parameters: unknown } }
export type AiProviderRequestOptions = {
  stream?: boolean
  includeUsage?: boolean
  tools?: AiFunctionTool[]
  maxTokens?: number
  temperature?: number
}
export type AiProviderRequest = { url: string; headers: Record<string, string>; body: string }
export type AiProviderDelta = { content?: string; reasoning?: string; usage?: AiUsage; toolCalls?: unknown[] }
export type AiProviderReply = {
  content: string
  reasoningContent?: string
  usage?: AiUsage
  finishReason?: string
  apiMessages?: AiChatMessage[]
}

/** Protocol adapters know HTTP/messages, never SSH targets, approvals or storage. */
export interface AiProviderAdapter {
  readonly supportsStreamUsageOption: boolean
  readonly allowsCompletionFallback: boolean
  buildRequest(settings: AiResolvedConfig, messages: AiChatMessage[], options?: AiProviderRequestOptions): AiProviderRequest
  parseResponse(settings: AiResolvedConfig, data: any): AiProviderReply
  readStream(settings: AiResolvedConfig, response: Response, onDelta: (delta: AiProviderDelta) => void): Promise<AiChatMessage>
  modelsRequest(provider: AiProviderCredentials, cursor?: string): { url: string; headers: Record<string, string> }
  parseModelsPage(data: any): { models: AiDiscoveredModel[]; nextCursor?: string }
}
