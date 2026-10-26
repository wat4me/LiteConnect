import type { AiChatMessage, AiImageAttachment } from './types/ai'
import { sharedT, type SharedTranslate } from './i18n'

export const AI_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const AI_IMAGES_PER_MESSAGE = 4
export const AI_IMAGES_REQUEST_MAX_BYTES = 20 * 1024 * 1024
export const AI_IMAGE_MAX_DIMENSION = 2048
export const AI_IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const

export function normalizeAiImages(raw: unknown, translate: SharedTranslate = sharedT): AiImageAttachment[] | undefined {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw) || raw.length > AI_IMAGES_PER_MESSAGE) throw new Error(translate('sharedText.imageLimit'))
  const images = raw.map((value): AiImageAttachment => {
    if (!value || typeof value !== 'object') throw new Error(translate('sharedText.imageAttachmentInvalid'))
    const image = value as Record<string, unknown>
    if (typeof image.id !== 'string' || !/^[a-f0-9]{64}$/.test(image.id) ||
      !AI_IMAGE_MIME_TYPES.includes(image.mimeType as AiImageAttachment['mimeType']) ||
      !Number.isInteger(image.width) || !Number.isInteger(image.height) ||
      Number(image.width) < 1 || Number(image.height) < 1 ||
      Number(image.width) > AI_IMAGE_MAX_DIMENSION || Number(image.height) > AI_IMAGE_MAX_DIMENSION) {
      throw new Error(translate('sharedText.imageAttachmentInvalid'))
    }
    const out: AiImageAttachment = {
      id: image.id, name: typeof image.name === 'string' ? image.name.slice(0, 200) : 'image',
      mimeType: image.mimeType as AiImageAttachment['mimeType'], width: Number(image.width), height: Number(image.height),
    }
    if (image.dataUrl !== undefined) {
      if (typeof image.dataUrl !== 'string' || !image.dataUrl.startsWith(`data:${out.mimeType};base64,`)) throw new Error(translate('sharedText.imageDataInvalid'))
      const payload = image.dataUrl.slice(image.dataUrl.indexOf(',') + 1)
      if (!payload || payload.length > Math.ceil(AI_IMAGE_MAX_BYTES / 3) * 4 ||
        payload.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(payload) || !/^[^=]*={0,2}$/.test(payload)) throw new Error(translate('sharedText.imageFormatInvalid'))
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

export function assertAiImageCapability(messages: AiChatMessage[], supportsImages?: boolean, translate: SharedTranslate = sharedT): void {
  if (messages.some(message => message.images?.length) && supportsImages !== true) {
    throw new Error(translate('sharedText.imageUnsupported'))
  }
}

/** Shared attachment availability/size rules, independent of any wire format. */
export function validateAiRequestImages(messages: readonly AiChatMessage[], translate: SharedTranslate = sharedT): void {
  let bytes = 0
  for (const message of messages) for (const image of message.images || []) {
    if (!image.dataUrl || image.missing) throw new Error(translate('sharedText.imageMissing', { name: image.name }))
    bytes += Math.ceil((image.dataUrl.length - image.dataUrl.indexOf(',') - 1) * 3 / 4)
    if (bytes > AI_IMAGES_REQUEST_MAX_BYTES) throw new Error(translate('sharedText.imageRequestTooLarge'))
  }
}
