import { DEFAULT_OUTPUT_RESERVE_TOKENS, estimateTokens, messageTokens, resolveContextWindowTokens } from './aiContext'
import { lookupModelsDevOutput } from './modelsDevContext'
import type { AiChatMessage, AiContextPressure, AiResolvedConfig } from './types/ai'

export const AI_COMPACTION_THRESHOLD_RATIO = 0.8
export const AI_COMPACTION_RETAIN_RATIO = 0.2
/** Small windows keep most of their capacity for input; the ratio also caps catalog limits. */
export const AI_OUTPUT_RESERVE_WINDOW_RATIO = 0.2

export type AiContextBudgetConfig = Partial<Pick<AiResolvedConfig, 'model' | 'contextWindowTokens' | 'maxOutputTokens' | 'compactionRetainTokens'>>

/**
 * Output reservation used when the per-model field is empty: the model's advertised
 * output limit when the catalog knows it, otherwise the default. Never above the default
 * or a share of the window, so a catalog limit cannot swallow the input budget.
 */
export function resolveAutoOutputReserveTokens(config: AiContextBudgetConfig): number {
  const advertised = lookupModelsDevOutput(config.model) ?? DEFAULT_OUTPUT_RESERVE_TOKENS
  const windowTokens = resolveContextWindowTokens(config.model, config.contextWindowTokens)
  return Math.min(advertised, DEFAULT_OUTPUT_RESERVE_TOKENS, Math.floor(windowTokens * AI_OUTPUT_RESERVE_WINDOW_RATIO))
}

export function resolveAiContextBudget(config: AiContextBudgetConfig) {
  const windowTokens = resolveContextWindowTokens(config.model, config.contextWindowTokens)
  const outputReserveTokens = Math.min(windowTokens - 512,
    positiveTokens(config.maxOutputTokens) ?? resolveAutoOutputReserveTokens(config))
  const inputBudgetTokens = windowTokens - outputReserveTokens
  const headroomTokens = Math.min(Math.floor(inputBudgetTokens * 0.2), 8_192, Math.max(256, Math.floor(windowTokens * 0.05)))
  const thresholdTokens = Math.floor(Math.min(inputBudgetTokens * AI_COMPACTION_THRESHOLD_RATIO, inputBudgetTokens - headroomTokens))
  const retainTokens = Math.min(thresholdTokens - 1,
    positiveTokens(config.compactionRetainTokens) ?? Math.min(15_000, Math.max(256, Math.floor(inputBudgetTokens * AI_COMPACTION_RETAIN_RATIO))))
  return { windowTokens, outputReserveTokens, inputBudgetTokens, thresholdTokens, retainTokens }
}

export function positiveTokens(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? Math.min(value, 4_000_000) : undefined
}

export function aiToolSchemaTokens(tools: unknown): number {
  if (tools === undefined) return 0
  return estimateTokens(JSON.stringify(tools)) + 32
}

/** The same model-visible request estimate is used by pressure checks and the UI. */
export function measureAiContextPressure(input: AiContextBudgetConfig & {
  systemPrompt: string
  extraSystem?: string
  toolSchemaTokens?: number
  messages: readonly AiChatMessage[]
}): AiContextPressure {
  const system = [input.systemPrompt, input.extraSystem].filter(text => text?.trim()).join('\n\n')
  const usedTokens = (system ? messageTokens({ role: 'system', content: system }) : 0)
    + (input.toolSchemaTokens || 0)
    + input.messages.filter(message => message.role !== 'system').reduce((sum, message) => sum + messageTokens(message), 0)
  return { ...resolveAiContextBudget(input), usedTokens }
}
