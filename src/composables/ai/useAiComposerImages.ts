import { computed, onScopeDispose, ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { AI_IMAGES_PER_MESSAGE } from '@shared/aiImages'
import type { AiImageAttachment } from '@shared/types/ai'
import { prepareAiImage } from '@/utils/ai/imageAttachment'

/** Owns attachment input and async preparation; the conversation owns the draft. */
export function useAiComposerImages(deps: {
  sessionId: () => string
  draft: () => { activeThreadId: string | null; draftImages: AiImageAttachment[] }
  loading: () => boolean
  supportsImages: () => boolean
  blocked: () => boolean
  containsTarget: (target: Node | null) => boolean
  ensureLoaded: () => Promise<void>
  t: (key: string) => string
}) {
  const draftImages = computed(() => deps.draft().draftImages)
  const imageInputRef = ref<HTMLInputElement | null>(null)
  const imageBusy = ref(false)
  const imageDragOver = ref(false)
  let disposed = false
  onScopeDispose(() => { disposed = true })

  async function addImages(files: File[]) {
    if (disposed || deps.loading() || imageBusy.value || deps.blocked() || !files.length) return
    if (!deps.supportsImages()) { ElMessage.warning(deps.t('ai.imagesNotEnabled')); return }
    const sessionId = deps.sessionId()
    let state: ReturnType<typeof deps.draft> | undefined
    let threadId: string | null = null
    const isCurrent = () => !disposed && sessionId === deps.sessionId() &&
      (!state || (state === deps.draft() && state.activeThreadId === threadId))
    imageBusy.value = true
    try {
      await deps.ensureLoaded()
      if (!isCurrent()) return
      state = deps.draft()
      threadId = state.activeThreadId
      if (state.draftImages.length + files.length > AI_IMAGES_PER_MESSAGE) { ElMessage.warning(deps.t('ai.imageCountLimit')); return }
      const prepared: AiImageAttachment[] = []
      for (const file of files) {
        prepared.push(await prepareAiImage(file))
        if (!isCurrent()) return
      }
      for (const image of prepared) if (!state.draftImages.some(existing => existing.id === image.id)) state.draftImages.push(image)
    } catch (error: any) {
      if (isCurrent()) ElMessage.warning(error?.message || deps.t('ai.imageReadFailed'))
    } finally { imageBusy.value = false }
  }

  function onImageSelection(event: Event) {
    const element = event.target as HTMLInputElement
    void addImages(Array.from(element.files || []))
    element.value = ''
  }
  function onImagePaste(event: ClipboardEvent) {
    const files = Array.from(event.clipboardData?.items || [])
      .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
      .map(item => item.getAsFile()).filter((file): file is File => !!file)
    if (!files.length) return
    event.preventDefault()
    void addImages(files)
  }
  function onImageDragOver(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    event.dataTransfer.dropEffect = deps.supportsImages() && !deps.loading() && !imageBusy.value && !deps.blocked() ? 'copy' : 'none'
    imageDragOver.value = !deps.blocked()
  }
  function onImageDrop(event: DragEvent) {
    if (!event.dataTransfer?.types.includes('Files')) return
    event.preventDefault()
    imageDragOver.value = false
    void addImages(Array.from(event.dataTransfer.files))
  }
  function onImageDragLeave(event: DragEvent) {
    if (deps.containsTarget(event.relatedTarget as Node | null)) return
    imageDragOver.value = false
  }

  return { draftImages, imageInputRef, imageBusy, imageDragOver, addImages, onImageSelection, onImagePaste, onImageDragOver, onImageDrop, onImageDragLeave }
}
