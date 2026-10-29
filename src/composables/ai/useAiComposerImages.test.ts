import { effectScope } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAiComposerImages } from './useAiComposerImages'
import type { AiImageAttachment } from '@shared/types/ai'

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), warning: vi.fn() }))
vi.mock('@/utils/ai/imageAttachment', () => ({ prepareAiImage: mocks.prepare }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: mocks.warning } }))

const image = (id: string): AiImageAttachment => ({ id, name: id, mimeType: 'image/png', width: 1, height: 1, dataUrl: 'data:image/png;base64,AA==' })
const file = { name: 'screenshot.png' } as File
const scopes: ReturnType<typeof effectScope>[] = []
beforeEach(() => { vi.resetAllMocks() })
afterEach(() => { for (const scope of scopes.splice(0)) scope.stop() })

function setup() {
  let sessionId = 'host-a'
  let state = { activeThreadId: 'thread-a', draftImages: [] as AiImageAttachment[] }
  let supported = true
  let blocked = false
  const scope = effectScope()
  scopes.push(scope)
  const images = scope.run(() => useAiComposerImages({
    sessionId: () => sessionId, draft: () => state,
    loading: () => false, supportsImages: () => supported, blocked: () => blocked,
    containsTarget: () => false, ensureLoaded: async () => {}, t: key => key,
  }))!
  return { images, scope, get state() { return state }, switchThread: () => { state.activeThreadId = 'thread-b' }, switchHost: () => { sessionId = 'host-b'; state = { activeThreadId: 'thread-a', draftImages: [] } }, disable: () => { supported = false }, block: () => { blocked = true } }
}

describe('composer image lifetime', () => {
  it('adds a pasted screenshot without a file picker', async () => {
    const { images, state } = setup()
    const preventDefault = vi.fn()
    mocks.prepare.mockResolvedValue(image('pasted'))
    images.onImagePaste({ preventDefault, clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } } as unknown as ClipboardEvent)
    await vi.waitFor(() => expect(state.draftImages.map(item => item.id)).toEqual(['pasted']))
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it('warns on unsupported image paste without decoding, but leaves normal text paste alone', () => {
    const fixture = setup()
    fixture.disable()
    const preventDefault = vi.fn()
    fixture.images.onImagePaste({ preventDefault, clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } } as unknown as ClipboardEvent)
    expect(mocks.warning).toHaveBeenCalledWith('ai.imagesNotEnabled')
    expect(mocks.prepare).not.toHaveBeenCalled()
    expect(fixture.state.draftImages).toEqual([])
    expect(preventDefault).toHaveBeenCalledOnce()
    preventDefault.mockClear()
    fixture.images.onImagePaste({ preventDefault, clipboardData: { items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }] } } as unknown as ClipboardEvent)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it.each(['thread', 'host', 'unmount'] as const)('discards preparation when the %s changes', async change => {
    const fixture = setup()
    let finish!: (value: AiImageAttachment) => void
    mocks.prepare.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const original = fixture.state
    const pending = fixture.images.addImages([file, file])
    await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1))
    if (change === 'thread') fixture.switchThread()
    else if (change === 'host') fixture.switchHost()
    else fixture.scope.stop()
    finish(image('one'))
    await pending
    expect(original.draftImages).toEqual([])
    expect(fixture.state.draftImages).toEqual([])
    expect(mocks.prepare).toHaveBeenCalledTimes(1)
    expect(fixture.images.imageBusy.value).toBe(false)
  })

  it('commits the batch once, deduplicating identical screenshots', async () => {
    const { images, state } = setup()
    mocks.prepare.mockResolvedValue(image('same'))
    await images.addImages([file, file])
    expect(state.draftImages.map(item => item.id)).toEqual(['same'])
  })

  it('does not leave a partial batch when a later file fails', async () => {
    const { images, state } = setup()
    mocks.prepare.mockResolvedValueOnce(image('one')).mockRejectedValueOnce(new Error('bad image'))
    await images.addImages([file, file])
    expect(state.draftImages).toEqual([])
    expect(mocks.warning).toHaveBeenCalledWith('bad image')
    expect(images.imageBusy.value).toBe(false)
  })

  it('does not show an old attachment failure in the next conversation', async () => {
    const fixture = setup()
    let fail!: (error: Error) => void
    mocks.prepare.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject }))
    const pending = fixture.images.addImages([file])
    await vi.waitFor(() => expect(mocks.prepare).toHaveBeenCalledTimes(1))
    fixture.switchThread()
    fail(new Error('old conversation failed'))
    await pending
    expect(mocks.warning).not.toHaveBeenCalled()
  })

  it('rejects unsupported models, hidden composers and oversized batches before decoding', async () => {
    const unsupported = setup()
    unsupported.disable()
    await unsupported.images.addImages([file])
    expect(mocks.warning).toHaveBeenCalledWith('ai.imagesNotEnabled')
    const hidden = setup()
    hidden.block()
    await hidden.images.addImages([file])
    const full = setup()
    full.state.draftImages.push(...['1', '2', '3', '4'].map(image))
    await full.images.addImages([file])
    expect(mocks.warning).toHaveBeenCalledWith('ai.imageCountLimit')
    expect(mocks.prepare).not.toHaveBeenCalled()
  })
})
