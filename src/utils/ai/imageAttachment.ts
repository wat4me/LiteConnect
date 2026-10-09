import { AI_IMAGE_MAX_BYTES, AI_IMAGE_MAX_DIMENSION, AI_IMAGE_MIME_TYPES } from '@shared/aiImages'
import type { AiImageAttachment } from '@shared/types/ai'

/** Normalize dimensions / payload before IPC; screenshots keep PNG unless too large. */
export async function prepareAiImage(file: File): Promise<AiImageAttachment> {
  if (!AI_IMAGE_MIME_TYPES.includes(file.type as AiImageAttachment['mimeType'])) throw new Error('请选择 PNG、JPEG 或 WebP 图片')
  if (file.size > 20 * 1024 * 1024) throw new Error('原始图片不能超过 20 MB')
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, AI_IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')!
    context.drawImage(bitmap, 0, 0, width, height)
    const encode = (mime: string, quality?: number): Promise<Blob> => new Promise((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('无法处理图片')), mime, quality)
    })
    let blob = await encode(file.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9)
    if (blob.size > AI_IMAGE_MAX_BYTES) {
      context.globalCompositeOperation = 'destination-over'
      context.fillStyle = '#fff'
      context.fillRect(0, 0, width, height)
      blob = await encode('image/jpeg', 0.85)
    }
    if (blob.size > AI_IMAGE_MAX_BYTES) throw new Error('处理后的图片超过 5 MB，请选择更小的图片')
    const bytes = await blob.arrayBuffer()
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    const id = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(new Error('无法读取图片'))
      reader.readAsDataURL(blob)
    })
    return { id, name: file.name || '截图', mimeType: blob.type as AiImageAttachment['mimeType'], width, height, dataUrl }
  } finally { bitmap.close() }
}
