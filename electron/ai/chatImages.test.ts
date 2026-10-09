import { afterEach, expect, it, vi } from 'vitest'
import { runAiChatCompletion } from './chatCompletion'
import { runAiChatStream } from './chatStream'
import { packRequestMessages } from './providerHttp'
import type { AiChatMessage, AiResolvedConfig } from '../../shared/types/ai'

const settings: AiResolvedConfig = { baseUrl: 'https://example.test/v1', apiKey: 'fixture', model: 'custom', systemPrompt: '', temperature: 0, supportsImages: true }
const messages: AiChatMessage[] = [{ role: 'user', content: '分析报错', images: [{ id: 'a'.repeat(64), name: 'error.png', width: 800, height: 450, mimeType: 'image/png', dataUrl: 'data:image/png;base64,aGVsbG8=' }] }]
afterEach(() => vi.unstubAllGlobals())

it.each(['completion', 'stream'])('uses the same image serializer in %s requests', async mode => {
  const fetcher = vi.fn(async () => mode === 'completion'
    ? new Response(JSON.stringify({ choices: [{ message: { content: '识别成功' } }] }))
    : new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: '识别成功' } }] })}\n\ndata: [DONE]\n\n`))
  vi.stubGlobal('fetch', fetcher)
  if (mode === 'completion') await runAiChatCompletion(settings, messages)
  else await runAiChatStream({ settings, messages, requestId: 'image-request', emit: () => {} })
  const body = JSON.parse((fetcher.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)
  expect(body.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: '分析报错' }, { type: 'image_url', image_url: { url: messages[0].images![0].dataUrl, detail: 'auto' } }] })
})

it('blocks disabled image models before network requests and surfaces provider rejection without a text-only retry', async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'model does not support image input' } }), { status: 400 }))
  vi.stubGlobal('fetch', fetcher)
  await expect(runAiChatCompletion({ ...settings, supportsImages: false }, messages)).rejects.toThrow('未启用')
  await expect(runAiChatStream({ settings: { ...settings, supportsImages: false }, messages, requestId: 'disabled-images', emit: () => {} })).rejects.toThrow('未启用')
  expect(fetcher).not.toHaveBeenCalled()
  await expect(runAiChatCompletion(settings, messages)).rejects.toThrow('does not support image')
  expect(fetcher).toHaveBeenCalledTimes(1)
})

it('fails explicitly when images exceed the model budget rather than stripping images', () => {
  const large: AiChatMessage[] = [{ ...messages[0], images: [{ ...messages[0].images![0], width: 2048, height: 2048 }] }]
  expect(() => packRequestMessages({ ...settings, contextWindowTokens: 4096 }, large)).toThrow('上下文预算')
})
