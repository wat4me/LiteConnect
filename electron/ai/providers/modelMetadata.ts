import { clampContextWindowTokens } from '../../../shared/aiContext'
import type { AiDiscoveredModel } from '../../../shared/types/ai'

export function parseProviderModels(data: any, contextFields: readonly string[]): AiDiscoveredModel[] {
  if (!Array.isArray(data?.data)) throw new Error('服务未返回兼容的模型列表，请手动添加模型')
  const models = new Map<string, AiDiscoveredModel>()
  for (const item of data.data) {
    if (typeof item?.id !== 'string' || !item.id.trim()) continue
    const id = item.id.trim()
    // Full input context fields only; max_tokens normally means output limits.
    const raw = contextFields.map(field => item[field]).find(value => typeof value === 'number' && Number.isFinite(value) && value >= 4096)
    const contextWindowTokens = clampContextWindowTokens(raw)
    if (!models.has(id) || contextWindowTokens) models.set(id, contextWindowTokens ? { id, contextWindowTokens } : { id })
  }
  return [...models.values()]
}
