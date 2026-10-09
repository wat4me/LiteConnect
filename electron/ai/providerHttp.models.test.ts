import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAiModelsUrl, listAiProviderModels } from './providerHttp'
import { parseAiModels, resolveModelContextWindow, modelContextSource } from '../../shared/aiContext'

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('provider model discovery', () => {
  it('uses the configured API prefix without adding another v1', () => {
    expect(getAiModelsUrl('https://example.com/v1/')).toBe('https://example.com/v1/models')
    expect(getAiModelsUrl('https://example.com')).toBe('https://example.com/models')
    expect(getAiModelsUrl('https://example.com/proxy/v1/chat/completions')).toBe('https://example.com/proxy/v1/models')
    expect(() => getAiModelsUrl('file:///secret')).toThrow()
  })
  it('authenticates and deduplicates valid IDs without inventing model metadata', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: ' b ' }, { id: 'a' }, { id: 'a' }, {}, null] })))
    vi.stubGlobal('fetch', fetcher)
    expect(await listAiProviderModels({ baseUrl: 'https://example.com/v1', apiKey: ' key ' })).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(fetcher).toHaveBeenCalledWith('https://example.com/v1/models', expect.objectContaining({ headers: { Authorization: 'Bearer key' } }))
  })
  it('rejects unsupported responses and does not expose response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private detail', { status: 401 })))
    await expect(listAiProviderModels({ baseUrl: 'https://example.com', apiKey: 'key' })).rejects.toThrow('HTTP 401')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}')))
    await expect(listAiProviderModels({ baseUrl: 'https://example.com', apiKey: 'key' })).rejects.toThrow()
  })
  it('times out a stalled request', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error(), { name: 'AbortError' })))
    })))
    const result = expect(listAiProviderModels({ baseUrl: 'https://example.com', apiKey: 'key' })).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(15000)
    await result
  })
  it('preserves display names and explicit context while keeping the API ID', () => {
    expect(parseAiModels([{ id: 'api-model', displayName: ' Short ', contextWindowTokens: 64000 }])).toEqual([{ id: 'api-model', displayName: 'Short', contextWindowTokens: 64000 }])
  })
  it('reads explicit full context metadata and ignores output limits and invalid values', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: 'a', context_length: 128000 }, { id: 'b', max_model_len: 64000 },
      { id: 'c', context_window: 32000 }, { id: 'd', max_tokens: 8192 },
      { id: 'e', context_length: -1 }, { id: 'f', context_length: 'unknown' },
    ] }))))
    expect(await listAiProviderModels({ baseUrl: 'https://example.com', apiKey: 'key' })).toEqual([
      { id: 'a', contextWindowTokens: 128000 }, { id: 'b', contextWindowTokens: 64000 },
      { id: 'c', contextWindowTokens: 32000 }, { id: 'd' }, { id: 'e' }, { id: 'f' },
    ])
  })
  it('preserves provider metadata across settings parsing and prioritizes manual limits', () => {
    const model = { id: 'custom', contextMetadata: { modelId: 'custom', tokens: 64000 } }
    expect(parseAiModels([model])).toEqual([model])
    expect(resolveModelContextWindow({ model: 'custom', models: [model] })).toBe(64000)
    expect(modelContextSource(model)).toEqual({ source: 'provider', tokens: 64000 })
    const manual = { ...model, contextWindowTokens: 32000 }
    expect(resolveModelContextWindow({ model: 'custom', models: [manual] })).toBe(32000)
    expect(modelContextSource(manual).source).toBe('manual')
    expect(parseAiModels([{ ...model, id: 'changed' }])).toEqual([{ id: 'changed' }])
    expect(modelContextSource({ ...model, id: 'changed' }).source).toBe('fallback')
    expect(modelContextSource({ id: 'custom-128k' }).source).toBe('name')
    expect(modelContextSource({ id: 'gpt-4o' }).source).toBe('catalog')
  })
})
