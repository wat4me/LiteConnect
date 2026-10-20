import { computed, onScopeDispose, ref, watch, type ComputedRef } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm, appPrompt } from '@/composables/app/useAppDialog'
import { isAiMarkdownFilePath } from '@shared/aiFixedContext'
import type { AiConversationContextFile } from '@shared/types/ai'
import { useAiContextFileStatus } from './useAiContextFileStatus'

export function useAiSidebarContextFiles(deps: {
  sessionId: () => string
  threadId: () => string
  loading: () => boolean
  active: () => boolean
  openGeneration: () => number
  files: ComputedRef<AiConversationContextFile[]>
  ensureLoaded: () => Promise<unknown>
  setFile: (sessionId: string, file: AiConversationContextFile) => Promise<boolean>
  removeFile: (sessionId: string, file: AiConversationContextFile, fromFuture: boolean) => Promise<boolean>
  t: (key: string, params?: Record<string, unknown>) => string
}) {
  const t = deps.t
  const contextFileBusy = ref(false)
  const contextFileMenuRef = ref<HTMLDetailsElement | null>(null)
  const contextFilePreviewKey = ref('')
  const { contextFileSourceStatus, contextFileKey, checkContextFileSource } = useAiContextFileStatus(deps)
  const contextFileName = (file: AiConversationContextFile) => file.path.split(/[\\/]/).pop() || file.path
  const previewContextFile = computed(() => deps.files.value.find(file => contextFileKey(file) === contextFilePreviewKey.value) || null)
  let disposed = false
  onScopeDispose(() => { disposed = true })

  function captureTarget() {
    const sessionId = deps.sessionId()
    const threadId = deps.threadId()
    return { sessionId, threadId,
      current: () => !disposed && deps.active() && deps.sessionId() === sessionId && deps.threadId() === threadId && !deps.loading() }
  }
  async function prepareTarget() {
    const sessionId = deps.sessionId()
    await deps.ensureLoaded()
    if (disposed || !deps.active() || deps.sessionId() !== sessionId || deps.loading()) return null
    return captureTarget()
  }
  function unavailable() { return disposed || deps.loading() || contextFileBusy.value || !deps.active() }
  function validateFile(file: AiConversationContextFile) {
    if (!file.content.trim() || file.content.includes('\0') || new TextEncoder().encode(file.content).length > 32 * 1024) {
      throw new Error(t('ai.contextFileInvalid'))
    }
  }

  function onContextFileMenuToggle() {
    if (contextFileMenuRef.value?.open) {
      contextFilePreviewKey.value = ''
      void checkContextFileSource()
    }
  }
  function toggleContextFilePreview(file: AiConversationContextFile) {
    contextFileMenuRef.value?.removeAttribute('open')
    const key = contextFileKey(file)
    contextFilePreviewKey.value = contextFilePreviewKey.value === key ? '' : key
  }
  function contextFileStatusNote(file: AiConversationContextFile) {
    const status = contextFileSourceStatus.value[contextFileKey(file)]
    if (status === 'missing') return t('ai.contextFileMissing')
    if (status === 'unavailable') return t('ai.contextFileUnavailable')
    return ''
  }
  function contextFileTitle(file: AiConversationContextFile) {
    const note = contextFileStatusNote(file) || t('ai.contextFileSnapshotHint')
    const source = file.source === 'ssh' ? t('ai.contextFileSourceSsh') : t('ai.contextFileSourceLocal')
    return `${source} · ${file.path}\n${note}`
  }
  function contextFileChipLabel(file: AiConversationContextFile) {
    const preview = t('ai.contextFilePreviewNamed', { name: contextFileName(file) })
    const note = contextFileStatusNote(file)
    return note ? `${preview}。${note}` : preview
  }
  watch([deps.files, deps.sessionId, deps.threadId], () => {
    if (!deps.files.value.some(file => contextFileKey(file) === contextFilePreviewKey.value)) contextFilePreviewKey.value = ''
  })

  async function chooseLocalContextFile() {
    contextFileMenuRef.value?.removeAttribute('open')
    if (unavailable()) return
    contextFileBusy.value = true
    try {
      const target = await prepareTarget()
      if (!target) return
      const file = await window.LiteConnect.aiSelectLocalContextFile()
      if (file && target.current()) {
        validateFile(file)
        await deps.setFile(target.sessionId, file)
      }
    } catch (error: any) {
      if (!disposed) ElMessage.warning(error?.message || t('ai.contextFileFailed'))
    } finally { contextFileBusy.value = false }
  }

  async function chooseSshContextFile() {
    contextFileMenuRef.value?.removeAttribute('open')
    if (unavailable()) return
    contextFileBusy.value = true
    try {
      const target = await prepareTarget()
      if (!target) return
      let path: string
      try {
        path = (await appPrompt({ title: t('ai.contextFileSsh'), message: t('ai.contextFileSshHint'),
          inputPlaceholder: '/home/user/AGENTS.md', maxLength: 1024 })).trim()
      } catch { return }
      if (!path || !target.current()) return
      if (!isAiMarkdownFilePath(path)) throw new Error(t('ai.contextFileMarkdownOnly'))
      const content = await window.LiteConnect.sftpReadFile(target.sessionId, path)
      if (!target.current()) return
      const file: AiConversationContextFile = { source: 'ssh', path, content }
      validateFile(file)
      await deps.setFile(target.sessionId, file)
    } catch (error: any) {
      if (!disposed) ElMessage.warning(error?.message || t('ai.contextFileFailed'))
    } finally { contextFileBusy.value = false }
  }

  async function removeContextFile(file: AiConversationContextFile) {
    if (unavailable()) return
    const target = captureTarget()
    let choice: 'confirm' | 'tertiary'
    try {
      choice = await appConfirm({ title: t('ai.contextFileRemoveTitle'),
        message: t('ai.contextFileRemoveChoice', { name: contextFileName(file) }), detail: file.path,
        confirmText: t('ai.contextFileRemoveFuture'), tertiaryText: t('ai.contextFileRemoveCurrent'),
        cancelText: t('common.cancel'), danger: true, tone: 'warning' })
    } catch { return }
    if (!target.current() || contextFileBusy.value) return
    contextFileBusy.value = true
    try {
      await deps.ensureLoaded()
      if (!target.current()) return
      if (await deps.removeFile(target.sessionId, file, choice === 'confirm')) {
        if (target.current()) ElMessage.success(t(choice === 'confirm' ? 'ai.contextFileRemovedFuture' : 'ai.contextFileRemovedCurrent'))
      }
    } catch (error: any) {
      if (target.current()) ElMessage.warning(error?.message || t('ai.contextFileFailed'))
    } finally { contextFileBusy.value = false }
  }

  async function refreshContextFile(file: AiConversationContextFile) {
    if (unavailable()) return
    const target = captureTarget()
    contextFileBusy.value = true
    try {
      const latest = file.source === 'local'
        ? await window.LiteConnect.aiReadLocalContextFile(target.sessionId, target.threadId, file.path)
        : { source: 'ssh' as const, path: file.path, content: await window.LiteConnect.sftpReadFile(target.sessionId, file.path) }
      if (!target.current()) return
      validateFile(latest)
      if (latest.content === file.content) { ElMessage.info(t('ai.contextFileUnchanged')); return }
      await appConfirm({ title: t('ai.contextFileRefreshTitle'),
        message: t('ai.contextFileRefreshConfirm', { name: contextFileName(file) }), detail: file.path,
        confirmText: t('ai.contextFileRefresh'), cancelText: t('common.cancel') })
      if (!target.current()) return
      if (await deps.setFile(target.sessionId, latest) && target.current()) {
        ElMessage.success(t('ai.contextFileRefreshed'))
        void checkContextFileSource()
      }
    } catch (error: any) {
      if (target.current() && error !== 'cancel') ElMessage.warning(error?.message || t('ai.contextFileRefreshFailed'))
    } finally { contextFileBusy.value = false }
  }

  return { contextFileBusy, contextFileMenuRef, contextFilePreviewKey, previewContextFile,
    contextFileName, contextFileKey, contextFileSourceStatus, contextFileTitle, contextFileChipLabel,
    onContextFileMenuToggle, toggleContextFilePreview, chooseLocalContextFile, chooseSshContextFile,
    removeContextFile, refreshContextFile }
}
