import { afterEach, expect, it, vi } from 'vitest'
import { useAiChat } from './useAiChat'
import type { AiSettings } from '../../env.d'

vi.mock('../../i18n', () => ({ t: (key: string) => key }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: vi.fn() } }))

const empty: AiSettings = {
  providers: [],
  activeProviderId: null,
  activeModel: '',
  systemPrompt: '',
  toolPermission: 'ask',
}

afterEach(() => {
  vi.unstubAllGlobals()
  useAiChat().replaceSettings({ ...empty, providers: [] })
})

it('shares saved providers across sidebar instances', async () => {
  const saved: AiSettings = {
    ...empty,
    providers: [
      {
        id: 'p1',
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-test',
        models: [{ id: 'gpt-4o-mini' }],
      },
    ],
    activeProviderId: 'p1',
    activeModel: 'gpt-4o-mini',
  }
  vi.stubGlobal('window', { LiteConnect: { getAiSettings: async () => saved } })
  const first = useAiChat()
  await first.refreshSettings()
  const second = useAiChat()
  expect(second.settings.value.providers).toEqual(saved.providers)
  expect(second.displayModelName.value).toBe('gpt-4o-mini')
})

it('does not let a stale load wipe a newer save', async () => {
  let resolveLoad: (value: AiSettings) => void = () => {}
  vi.stubGlobal('window', {
    LiteConnect: {
      getAiSettings: () =>
        new Promise<AiSettings>((resolve) => {
          resolveLoad = resolve
        }),
    },
  })
  const chat = useAiChat()
  const pending = chat.refreshSettings()
  chat.replaceSettings({
    ...empty,
    providers: [{ id: 'p1', name: 'Kept', baseUrl: 'https://x', apiKey: 'k', models: [{ id: 'm' }] }],
    activeProviderId: 'p1',
    activeModel: 'm',
  })
  resolveLoad(empty)
  await pending
  expect(chat.settings.value.providers.map((p) => p.id)).toEqual(['p1'])
})
