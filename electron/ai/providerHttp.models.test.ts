import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAiModelsUrl, listAiProviderModels } from './providerHttp'
import { parseAiModels } from '../../shared/aiContext'

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
    expect(await listAiProviderModels({ baseUrl: 'https://example.com/v1', apiKey: ' key ' })).toEqual(['a', 'b'])
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
})
