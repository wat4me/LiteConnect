import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import { closeAppDatabase, getAppDatabase, initializeAppDatabase, aiSessionKey } from '../store/appDatabase'
import { readAiSessionStore, writeAiSessionStore } from './historyStore'
import { toApiChatMessages, flattenConversationForApi } from '../../shared/aiMessages'
import type { AiImageAttachment, AiSessionStore } from '../../shared/types/ai'

const appPath = vi.hoisted(() => ({ value: '' }))
vi.mock('electron', () => ({
  app: { getPath: () => appPath.value },
  nativeImage: { createFromBuffer: () => ({ getSize: () => ({ width: 1, height: 1 }), isEmpty: () => false }) },
}))
const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const bytes = Buffer.from(base64, 'base64')
const image: AiImageAttachment = { id: createHash('sha256').update(bytes).digest('hex'), name: '截图.png', mimeType: 'image/png', width: 1, height: 1, dataUrl: `data:image/png;base64,${base64}` }
function store(): AiSessionStore {
  return { version: 1, activeThreadId: 't', defaultContextFiles: [], threads: [
    { id: 't', title: '', createdAt: 1, updatedAt: 1, contextFiles: [], messages: [{ id: 'u', role: 'user', content: '', images: [image], createdAt: 1 }] },
    { id: 'other', title: '', createdAt: 2, updatedAt: 2, contextFiles: [], messages: [{ id: 'u2', role: 'user', content: 'another', images: [image], createdAt: 2 }] },
  ] }
}
const imageDir = (host: string) => join(appPath.value, 'ai-images', createHash('sha256').update(host).digest('hex'))
beforeAll(async () => {
  appPath.value = await mkdtemp(join(tmpdir(), 'lite-ai-images-test-'))
  await initializeAppDatabase(appPath.value)
})
afterAll(async () => {
  closeAppDatabase()
  const root = resolve(appPath.value)
  if (!root.startsWith(resolve(tmpdir()) + sep) || !root.includes('lite-ai-images-test-')) throw new Error('Invalid test directory')
  await rm(root, { recursive: true, force: true })
})

it('persists bytes separately, hydrates only the active thread and collects only unreferenced images', async () => {
  await writeAiSessionStore('host', store())
  expect(JSON.stringify(getAppDatabase().getSingleton(aiSessionKey('host')))).not.toContain('base64')
  expect(await readdir(imageDir('host'))).toEqual([`${image.id}.image`])
  expect(await readFile(join(imageDir('host'), `${image.id}.image`))).toEqual(bytes)
  let loaded = await readAiSessionStore('host')
  expect(loaded.threads[0].messages[0].images?.[0].dataUrl).toBe(image.dataUrl)
  expect(loaded.threads[1].messages[0].images?.[0].dataUrl).toBeUndefined()
  expect(toApiChatMessages(flattenConversationForApi(loaded.threads[0].messages), true)[0]).toMatchObject({ role: 'user', content: [{ type: 'image_url' }] })
  loaded.threads.shift()
  loaded.activeThreadId = 'other'
  await writeAiSessionStore('host', loaded)
  expect(await readdir(imageDir('host'))).toHaveLength(1)
  loaded = await readAiSessionStore('host')
  expect(loaded.threads[0].messages[0].images?.[0].dataUrl).toBe(image.dataUrl)
  loaded.threads[0].messages = []
  await writeAiSessionStore('host', loaded)
  expect(await readdir(imageDir('host'))).toEqual([])
})

it('keeps a missing attachment visible and blocks replay without silently dropping the image', async () => {
  await writeAiSessionStore('missing', store())
  await unlink(join(imageDir('missing'), `${image.id}.image`))
  const loaded = await readAiSessionStore('missing')
  expect(loaded.threads[0].messages[0].images?.[0].missing).toBe(true)
  expect(() => toApiChatMessages(flattenConversationForApi(loaded.threads[0].messages), false)).toThrow('已丢失')
})

it('rejects forged paths, hashes, mime types and dimensions before committing history', async () => {
  const forged = store()
  forged.threads[0].messages[0].images = [{ ...image, id: 'a'.repeat(64) }]
  await expect(writeAiSessionStore('forged', forged)).rejects.toThrow('引用不匹配')
  expect(getAppDatabase().getSingleton(aiSessionKey('forged'))).toBeUndefined()
  forged.threads[0].messages[0].images = [{ ...image, width: 2 }]
  await expect(writeAiSessionStore('forged', forged)).rejects.toThrow('尺寸不匹配')
  forged.threads[0].messages[0].images = [{ ...image, id: '../secret' }]
  await expect(writeAiSessionStore('forged', forged)).rejects.toThrow()
})

it('scopes references to the SSH host and never reads a file from another host', async () => {
  await writeAiSessionStore('owner', store())
  const other = store()
  for (const thread of other.threads) for (const message of thread.messages) message.images = [{ ...image, dataUrl: undefined }]
  await writeAiSessionStore('other-host', other)
  expect((await readAiSessionStore('other-host')).threads[0].messages[0].images?.[0].missing).toBe(true)
})

it('repairs a corrupt attachment when the user reattaches the original image', async () => {
  await writeAiSessionStore('repair', store())
  await writeFile(join(imageDir('repair'), `${image.id}.image`), 'corrupted')
  expect((await readAiSessionStore('repair')).threads[0].messages[0].images?.[0].missing).toBe(true)
  await writeAiSessionStore('repair', store())
  expect((await readAiSessionStore('repair')).threads[0].messages[0].images?.[0].dataUrl).toBe(image.dataUrl)
})
