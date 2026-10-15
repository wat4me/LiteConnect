import type { AiDiscoveredModel, AiResolvedConfig } from '../../../shared/types/ai'
import { getAiProviderAdapter } from './registry'
import type { AiProviderCredentials } from './types'

/** Network orchestration shared by providers; adapters own their model schemas. */
export async function listAiProviderModels(provider: AiProviderCredentials): Promise<AiDiscoveredModel[]> {
  const adapter = getAiProviderAdapter(provider.protocol)
  if (!provider.apiKey?.trim()) throw new Error('AI API key is required')
  // Validate the endpoint before opening the timeout scope.
  adapter.modelsRequest(provider)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const models = new Map<string, AiDiscoveredModel>()
    const cursors = new Set<string>()
    let cursor: string | undefined
    do {
      const request = adapter.modelsRequest(provider, cursor)
      const response = await fetch(request.url, { headers: request.headers, signal: controller.signal })
      if (!response.ok) throw new Error(`获取模型失败 (HTTP ${response.status})，请检查 API 地址和密钥，或手动添加模型`)
      const page = adapter.parseModelsPage(await response.json())
      for (const model of page.models) {
        if (!models.has(model.id) || model.contextWindowTokens) models.set(model.id, model)
      }
      cursor = page.nextCursor
      if (cursor) {
        if (cursors.has(cursor) || cursors.size >= 100) throw new Error('Invalid AI model pagination')
        cursors.add(cursor)
      }
    } while (cursor)
    return [...models.values()].sort((a, b) => a.id.localeCompare(b.id))
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('获取模型超时，请重试或手动添加模型')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function testAiProviderConfig(provider: AiProviderCredentials & { model: string }): Promise<void> {
  if (!provider || typeof provider !== 'object') throw new Error('Invalid AI provider')
  const adapter = getAiProviderAdapter(provider.protocol)
  const apiKey = typeof provider.apiKey === 'string' ? provider.apiKey.trim() : ''
  const model = typeof provider.model === 'string' ? provider.model.trim() : ''
  if (!apiKey) throw new Error('AI API key is required')
  if (!model) throw new Error('AI model is required')
  const settings: AiResolvedConfig = { ...provider, apiKey, model, systemPrompt: '', temperature: 0 }
  const request = adapter.buildRequest(settings, [{ role: 'user', content: 'ping' }], { maxTokens: 1, temperature: 0, stream: false })
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 15_000)
  try {
    const response = await fetch(request.url, {
      method: 'POST', headers: request.headers, body: request.body, signal: controller.signal,
    })
    if (response.ok) return
    const detail = (await response.text()).replace(/\s+/g, ' ').slice(0, 300)
    throw new Error(`AI provider returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error('AI provider connection timed out')
    throw error
  } finally {
    clearTimeout(timeout)
  }
}
