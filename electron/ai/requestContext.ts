import { packAiMessages, type AiContextMessage } from '../../shared/aiContext'
import type { AiChatMessage } from '../../shared/types/ai'

export function packRequestMessages(
  settings: { systemPrompt: string; model: string; contextWindowTokens?: number },
  incoming: AiChatMessage[],
  budgetTokens?: number,
  extraSystem?: string,
  systemMaxTokens?: number,
): AiContextMessage[] {
  const systemPrompt = [settings.systemPrompt, extraSystem].filter((s) => s && s.trim()).join('\n\n')
  const packed = packAiMessages({
    systemPrompt,
    systemMaxTokens,
    messages: incoming.filter((m) => m.role !== 'system'),
    model: settings.model,
    budgetTokens,
    contextWindowTokens: settings.contextWindowTokens,
  })
  if (packed.promptTokens > packed.budgetTokens && packed.messages.some(message => message.images?.length)) {
    throw new Error('图片超出当前模型的上下文预算，请减少图片或调整模型上下文窗口')
  }
  return packed.messages
}
