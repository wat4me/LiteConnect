import { describe, expect, it, vi } from 'vitest'
import { AiSettingsService } from './aiSettingsService'

function createService(stored: Record<string, any>) {
  const save = vi.fn(async () => {})
  const service = new AiSettingsService(() => stored, save, {
    encrypt: (value) => value ? `encrypted:${value}` : value,
    decryptOrEmpty: (value) => value.replace(/^encrypted:/, ''),
    encryptionAvailable: () => true,
  })
  return { service, save }
}

describe('AiSettingsService', () => {
  it('persists explicit image capability per model and resolves it after a model switch', async () => {
    const stored: Record<string, any> = {}
    const { service } = createService(stored)
    await service.setAiSettings({ providers: [{ id: 'p', name: 'Custom', baseUrl: 'https://example.test/v1', apiKey: '', models: [{ id: 'vision', supportsImages: true }, { id: 'text', supportsImages: false }] }], activeProviderId: 'p', activeModel: 'vision' })
    expect(service.getAiSettings().providers[0].models[0].supportsImages).toBe(true)
    expect(service.getAiResolvedConfig().supportsImages).toBe(true)
    await service.switchAiModel('p', 'text')
    expect(service.getAiResolvedConfig().supportsImages).toBe(false)
  })
  it('keeps API keys encrypted at rest and exposes plaintext to the AI runtime', async () => {
    const stored: Record<string, any> = {}
    const { service, save } = createService(stored)
    await service.setAiSettings({
      providers: [{ id: 'provider', name: 'Provider', baseUrl: 'https://api.example.test', apiKey: 'secret', models: ['model-a'] }],
      activeProviderId: 'provider',
      activeModel: 'model-a',
    })

    expect(save).toHaveBeenCalledTimes(1)
    expect(stored.ai.providers[0].apiKey).toBe('encrypted:secret')
    expect(stored.ai.providers[0].apiKeyEncrypted).toBe(true)
    expect(service.getAiSettings().providers[0].apiKey).toBe('secret')
    expect(service.getAiResolvedConfig()).toMatchObject({
      baseUrl: 'https://api.example.test', model: 'model-a', apiKey: 'secret',
    })
  })

  it('resolves an explicit provider/model without changing the active pair', async () => {
    const stored: Record<string, any> = {}
    const { service } = createService(stored)
    await service.setAiSettings({
      providers: [
        { id: 'a', name: 'A', baseUrl: 'https://a.example', apiKey: 'alpha', models: ['a1'] },
        { id: 'b', name: 'B', baseUrl: 'https://b.example', apiKey: 'beta', models: ['b1', 'b2'] },
      ],
      activeProviderId: 'a', activeModel: 'a1',
    })
    expect(service.resolveAiConfig('b', 'b2')).toMatchObject({ baseUrl: 'https://b.example', model: 'b2', apiKey: 'beta' })
    expect(service.getAiResolvedConfig()).toMatchObject({ model: 'a1', apiKey: 'alpha' })
    expect(() => service.resolveAiConfig('missing', 'x')).toThrow(/服务商/)
    expect(() => service.resolveAiConfig('b', 'missing')).toThrow(/模型/)
  })

  it('preserves existing policy defaults when saving a partial update and persists a model switch', async () => {
    const stored: Record<string, any> = {
      ai: {
        providers: [{ id: 'provider', name: 'Provider', baseUrl: 'https://api.example.test', apiKey: '', models: ['model-a', 'model-b'] }],
        activeProviderId: 'provider', activeModel: 'model-a',
        toolPermission: 'readonly', approvalNotifications: false,
      },
    }
    const { service, save } = createService(stored)
    await service.setAiSettings({ providers: stored.ai.providers, activeProviderId: 'provider', activeModel: 'model-a' })
    expect(stored.ai.toolPermission).toBe('readonly')
    expect(stored.ai.approvalNotifications).toBe(false)

    const switched = await service.switchAiModel('provider', 'model-b')
    expect(switched.activeModel).toBe('model-b')
    expect(stored.ai.activeModel).toBe('model-b')
    expect(save).toHaveBeenCalledTimes(2)
  })
})
