import { describe, expect, it } from 'vitest'
import { aiImageTokens, assertAiImageCapability, normalizeAiImages, validateAiRequestImages } from './aiImages'
import { flattenConversationForApi, validateAiMessages } from './aiMessages'
import { packAiMessages, parseAiModels } from './aiContext'
import { aiHistoryRecordForSummary } from './aiCompaction'
import type { AiImageAttachment } from './types/ai'

const image: AiImageAttachment = { id: 'a'.repeat(64), name: 'error.png', mimeType: 'image/png', width: 600, height: 400, dataUrl: 'data:image/png;base64,aGVsbG8=' }

describe('AI image message protocol', () => {
  it('sends image-only messages and replays original images with text alongside tool history', () => {
    const history = [
      { role: 'user', content: '', images: [image] },
      { role: 'assistant', content: 'analysis', apiMessages: [
        { role: 'assistant', content: '', toolCalls: [{ id: 't', type: 'function', function: { name: 'exec', arguments: '{}' } }] },
        { role: 'tool', content: 'done', toolCallId: 't' },
        { role: 'assistant', content: 'fixed' },
      ] },
      { role: 'user', content: 'compare', images: [image] },
    ]
    const projected = flattenConversationForApi(history as Parameters<typeof flattenConversationForApi>[0])
    expect(projected.filter(message => message.images?.length)).toHaveLength(2)
    expect(projected[0]).toMatchObject({ role: 'user', images: [image] })
    expect(projected.at(-1)).toMatchObject({ role: 'user', content: 'compare', images: [image] })
    expect(projected[2]).toEqual({ role: 'tool', toolCallId: 't', content: 'done' })
  })
  it('keeps images while packing/truncating and accounts for visual input without counting base64 as text', () => {
    const packed = packAiMessages({ messages: [{ role: 'user', content: 'x'.repeat(10000), images: [image] }], budgetTokens: 1100, reserveOutputTokens: 0 })
    expect(packed.messages[0].images).toEqual([image])
    expect(packed.promptTokens).toBeGreaterThan(aiImageTokens([image]))
    expect(packed.promptTokens).toBeLessThanOrEqual(1100)
    const summary = aiHistoryRecordForSummary({ id: 'u', createdAt: 1, role: 'user', content: '', images: [image] }, 1000)
    expect(summary?.images).toEqual([image])
    expect(summary?.content).toContain('error.png')
  })
  it('validates image references, mime/data and count, and refuses missing files / disabled models', () => {
    expect(() => normalizeAiImages([{ ...image, id: '../file' }])).toThrow()
    expect(() => normalizeAiImages([{ ...image, dataUrl: 'https://example.com/image.png' }])).toThrow()
    expect(() => normalizeAiImages([{ ...image, mimeType: 'image/svg+xml' }])).toThrow()
    expect(() => normalizeAiImages(Array(5).fill(image))).toThrow()
    expect(() => validateAiMessages([{ role: 'user', content: '', images: [image] }])).not.toThrow()
    expect(() => validateAiRequestImages([{ role: 'user', content: '', images: [{ ...image, dataUrl: undefined, missing: true }] }])).toThrow('已丢失')
    expect(() => assertAiImageCapability([{ role: 'user', content: '', images: [image] }], false)).toThrow('未启用')
    expect(parseAiModels([{ id: 'custom', supportsImages: true }, { id: 'text', supportsImages: false }])).toEqual([{ id: 'custom', supportsImages: true }, { id: 'text', supportsImages: false }])
  })
  it('rejects aggregate request payloads exceeding the shared limit', () => {
    const large = { ...image, dataUrl: `data:image/png;base64,${'a'.repeat(4 * 1024 * 1024)}` }
    expect(() => validateAiRequestImages(Array.from({ length: 7 }, () => ({ role: 'user', content: 'image', images: [large] })))).toThrow('20 MB')
  })
})
