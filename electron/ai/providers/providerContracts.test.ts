import { describe, expect, it } from 'vitest'
import type { AiChatMessage, AiImageAttachment, AiProviderProtocol, AiResolvedConfig } from '../../../shared/types/ai'
import { getAiProviderAdapter } from './registry'

const image: AiImageAttachment = { id: 'a'.repeat(64), name: 'error.png', mimeType: 'image/png', width: 600, height: 400, dataUrl: 'data:image/png;base64,aGVsbG8=' }
const settings: AiResolvedConfig = { baseUrl: 'https://example.test/v1', model: 'fixture', apiKey: 'fixture', systemPrompt: '', temperature: 0 }

describe.each<AiProviderProtocol>(['openai', 'anthropic'])('%s provider contract', protocol => {
  const adapter = getAiProviderAdapter(protocol)
  it('serializes images and tool history through its own protocol', () => {
    const messages: AiChatMessage[] = [
      { role: 'user', content: '', images: [image] },
      { role: 'assistant', content: '', toolCalls: [{ id: 't', type: 'function', function: { name: 'exec', arguments: '{}' } }] },
      { role: 'tool', toolCallId: 't', content: 'done' },
      { role: 'assistant', content: 'fixed' },
      { role: 'user', content: 'compare', images: [image] },
    ]
    const body = JSON.parse(adapter.buildRequest({ ...settings, protocol }, messages, { tools: [{ type: 'function', function: { name: 'exec', parameters: { type: 'object' } } }] }).body)
    expect(body.messages[0].content[0].type).toBe(protocol === 'openai' ? 'image_url' : 'image')
    expect(body.messages.at(-1).content[0]).toEqual({ type: 'text', text: 'compare' })
    if (protocol === 'openai') expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: 't', content: 'done' })
    else expect(body.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'done' }] })
  })
  it('applies identical missing-attachment and total image-size limits', () => {
    expect(() => adapter.buildRequest(settings, [{ role: 'user', content: '', images: [{ ...image, missing: true }] }])).toThrow('已丢失')
    const large = { ...image, dataUrl: `data:image/png;base64,${'a'.repeat(4 * 1024 * 1024)}` }
    expect(() => adapter.buildRequest(settings, Array.from({ length: 7 }, () => ({ role: 'user', content: 'image', images: [large] })))).toThrow('20 MB')
  })
})

it('selects old configurations through the registry and rejects unknown protocols', () => {
  expect(getAiProviderAdapter()).toBe(getAiProviderAdapter('openai'))
  expect(() => getAiProviderAdapter('unknown' as AiProviderProtocol)).toThrow('Unsupported')
})
