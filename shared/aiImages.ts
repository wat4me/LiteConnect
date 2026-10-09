import type { AiChatMessage, AiImageAttachment } from './types/ai'

export const AI_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const AI_IMAGES_PER_MESSAGE = 4
export const AI_IMAGES_REQUEST_MAX_BYTES = 20 * 1024 * 1024
export const AI_IMAGE_MAX_DIMENSION = 2048
export const AI_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export function normalizeAiImages(raw: unknown): AiImageAttachment[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw) || raw.length > AI_IMAGES_PER_MESSAGE) throw new Error('每条消息最多添加 4 张图片')
  const images = raw.map((value): AiImageAttachment => {
    if (!value || typeof value !== 'object') throw new Error('无效的图片附件')
    const image = value as Record<string, unknown>
    if (typeof image.id !== 'string' || !/^[a-f0-9]{64}$/.test(image.id) ||
      !AI_IMAGE_MIME_TYPES.includes(image.mimeType as AiImageAttachment['mimeType']) ||
      !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      Number(image.width) < 1 || Number(image.height) < 1 ||
      Number(image.width) > AI_IMAGE_MAX_DIMENSION || Number(image.height) > AI_IMAGE_MAX_DIMENSION) {
      throw new Error('无效的图片附件')
    }
    const out: AiImageAttachment = {
      id: image.id, name: typeof image.name === 'string' ? image.name.slice(0, 200) : 'image',
      mimeType: image.mimeType as AiImageAttachment['mimeType'], width: Number(image.width), height: Number(image.height),
    }
    if (image.dataUrl !== undefined) {
      if (typeof image.dataUrl !== 'string' || !image.dataUrl.startsWith(`data:${out.mimeType};base64,`)) throw new Error('无效的图片数据')
      const payload = image.dataUrl.slice(image.dataUrl.indexOf(',') + 1)
      if (!payload || payload.length > Math.ceil(AI_IMAGE_MAX_BYTES / 3) * 4 ||
        payload.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(payload) || !/^[^=]*={0,2}$/.test(payload)) throw new Error('图片格式无效或超过 5 MB')
      out.dataUrl = image.dataUrl
    }
    if (image.missing === true) out.missing = true
    return out
  })
  return images.length ? images : undefined
}

/** Conservative high-detail tile estimate; billing differs between providers. */
export function aiImageTokens(images: AiImageAttachment[] | undefined): number {
  return (images || []).reduce((sum, image) => sum + 85 + 170 * Math.ceil(image.width / 512) * Math.ceil(image.height / 512), 0)
}

export function assertAiImageCapability(messages: AiChatMessage[], supportsImages?: boolean): void {
  if (messages.some(message => message.images?.length) && supportsImages !== true) {
    throw new Error('当前模型未启用图片支持。请在模型设置中启用支持图片，或切换支持图片的模型；历史含图片时也需要使用支持图片的模型。')
  }
}
