import { app, nativeImage } from 'electron'
import { createHash } from 'crypto'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'fs/promises'
import { join } from 'path'
import { AI_IMAGE_MAX_BYTES, normalizeAiImages } from '../../shared/aiImages'
import type { AiSessionStore } from '../../shared/types/ai'

function directory(historyId: string): string {
  return join(app.getPath('userData'), 'ai-images', createHash('sha256').update(historyId).digest('hex'))
}

function imagePath(historyId: string, id: string): string {
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid image reference')
  return join(directory(historyId), `${id}.image`)
}

function matchesMime(bytes: Buffer, mime: string): boolean {
  if (mime === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
  return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
}

/** Persist bytes before committing references. No URLs or arbitrary file paths are accepted. */
export async function externalizeAiImages(historyId: string, store: AiSessionStore): Promise<AiSessionStore> {
  const snapshot: AiSessionStore = JSON.parse(JSON.stringify(store))
  for (const thread of snapshot.threads) {
    for (const message of thread.messages) {
      if (!message.images?.length) continue
      const images = normalizeAiImages(message.images)!
      for (const image of images) {
        if (image.dataUrl) {
          const bytes = Buffer.from(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1), 'base64')
          if (bytes.length > AI_IMAGE_MAX_BYTES || !matchesMime(bytes, image.mimeType) ||
            createHash('sha256').update(bytes).digest('hex') !== image.id) throw new Error('图片数据与附件引用不匹配')
          const decoded = nativeImage.createFromBuffer(bytes)
          const size = decoded.getSize()
          if (decoded.isEmpty() || size.width !== image.width || size.height !== image.height) throw new Error('无法读取图片，或图片尺寸不匹配')
          await mkdir(directory(historyId), { recursive: true })
          try {
            await writeFile(imagePath(historyId, image.id), bytes, { flag: 'wx' })
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            const existing = await readFile(imagePath(historyId, image.id))
            if (!existing.equals(bytes)) await writeFile(imagePath(historyId, image.id), bytes)
          }
        }
        delete image.dataUrl
        delete image.missing
      }
      message.images = images
    }
  }
  return snapshot
}

/** Missing local files remain visible as attachments; model requests fail explicitly. */
export async function hydrateAiImages(historyId: string, store: AiSessionStore, threadId = store.activeThreadId): Promise<AiSessionStore> {
  const cache = new Map<string, string | undefined>()
  for (const thread of store.threads) {
    if (thread.id !== threadId) continue
    for (const message of thread.messages) {
      for (const image of message.images || []) {
        const key = `${image.id}:${image.mimeType}`
        if (!cache.has(key)) {
          try {
            const path = imagePath(historyId, image.id)
            if ((await stat(path)).size > AI_IMAGE_MAX_BYTES) throw new Error('Image too large')
            const bytes = await readFile(path)
            if (!matchesMime(bytes, image.mimeType) || createHash('sha256').update(bytes).digest('hex') !== image.id) throw new Error('Invalid image')
            cache.set(key, `data:${image.mimeType};base64,${bytes.toString('base64')}`)
          } catch { cache.set(key, undefined) }
        }
        image.dataUrl = cache.get(key)
        image.missing = !image.dataUrl
      }
    }
  }
  return store
}

/** Runs after the history commit, under the same host write queue. */
export async function pruneAiImageFiles(historyId: string, store: AiSessionStore): Promise<void> {
  const retained = new Set(store.threads.flatMap(thread => thread.messages.flatMap(message => (message.images || []).map(image => `${image.id}.image`))))
  let files: string[]
  try { files = await readdir(directory(historyId)) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  for (const file of files) {
    if (/^[a-f0-9]{64}\.image$/.test(file) && !retained.has(file)) await unlink(join(directory(historyId), file))
  }
}
