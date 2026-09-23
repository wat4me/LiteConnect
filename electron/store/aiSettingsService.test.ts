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
