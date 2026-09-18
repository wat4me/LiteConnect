<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { appConfirm } from '@/composables/app/useAppDialog'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{
  visible: boolean
  sessionId: string
  remotePath: string
  fileName: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved'): void
}>()

const { t } = useI18n()

const content = ref('')
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const editorRef = ref<HTMLTextAreaElement | null>(null)
const gutterRef = ref<HTMLDivElement | null>(null)
const dirty = ref(false)
/** A failed read leaves nothing to edit; saving then would truncate the remote file to whatever was typed. */
const loadFailed = ref(false)
/** The textarea normalises to LF; remember the file's own style so saving does not rewrite every line. */
let lineEnding: '\n' | '\r\n' = '\n'
/** Guards against a slow load for a previous file landing after a newer one. */
let loadSeq = 0

const lineCount = computed(() => {
  if (!content.value) return 1
  let n = 1
  for (let i = 0; i < content.value.length; i++) {
    if (content.value[i] === '\n') n++
  }
  return n
})

const lineNumbers = computed(() => {
  const arr: number[] = []
  for (let i = 1; i <= lineCount.value; i++) arr.push(i)
  return arr
})

function handleScroll() {
  if (gutterRef.value && editorRef.value) {
    gutterRef.value.scrollTop = editorRef.value.scrollTop
  }
}

watch(() => props.visible, async (val) => {
  if (val) {
    dirty.value = false
    error.value = ''
    await loadFile()
  }
})

async function loadFile() {
  const seq = ++loadSeq
  loading.value = true
  loadFailed.value = false
  error.value = ''
  try {
    const raw = await window.LiteConnect.sftpReadFile(props.sessionId, props.remotePath)
    if (seq !== loadSeq) return
    lineEnding = raw.includes('\r\n') ? '\r\n' : '\n'
    content.value = raw.replace(/\r\n/g, '\n')
    dirty.value = false
  } catch (err: any) {
    if (seq !== loadSeq) return
    error.value = err.message || t('sftp.readFileFailed')
    content.value = ''
    loadFailed.value = true
  } finally {
    if (seq === loadSeq) {
      loading.value = false
      await nextTick()
      editorRef.value?.focus()
    }
  }
}

async function saveFile() {
  if (saving.value || loadFailed.value) return
  saving.value = true
  error.value = ''
  try {
    const text = lineEnding === '\r\n' ? content.value.replace(/\r?\n/g, '\r\n') : content.value
    await window.LiteConnect.sftpWriteFile(props.sessionId, props.remotePath, text)
    dirty.value = false
    emit('saved')
  } catch (err: any) {
    error.value = err.message || t('sftp.saveFailed')
  } finally {
    saving.value = false
  }
}

/** Close only after the user agrees to drop unsaved edits. */
async function requestClose() {
  if (saving.value) return
  if (dirty.value) {
    try {
      await appConfirm({
        title: t('sftp.discardTitle'),
        message: t('sftp.discardMessage', { name: props.fileName }),
        confirmText: t('sftp.discardConfirm'),
        danger: true,
        tone: 'warning',
      })
    } catch {
      return
    }
  }
  emit('close')
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    if (dirty.value && !saving.value && !loadFailed.value) {
      saveFile()
    }
  }
  if (e.key === 'Escape') {
    void requestClose()
  }
}

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (dirty.value) {
    e.preventDefault()
  }
}

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload)
})

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload)
})
</script>

<template>
  <div v-if="visible" class="editor-overlay" @click.self="requestClose">
    <div class="editor-modal" @keydown="handleKeydown">
      <div class="editor-header">
        <div class="editor-title-group">
          <h3 class="editor-title">{{ fileName }}</h3>
          <span class="editor-path">{{ remotePath }}</span>
        </div>
        <div class="editor-actions">
          <span v-if="dirty" class="editor-dirty-dot" :title="t('sftp.dirtyTitle')"></span>
          <button
            class="editor-save-btn"
            :disabled="saving || !dirty || loadFailed"
            @click="saveFile"
          >
            {{ saving ? t('sftp.saving') : t('common.save') }}
          </button>
          <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" @click="requestClose" :title="t('common.close')">
            <AppIcon name="close" size="sm" />
          </button>
        </div>
      </div>

      <div v-if="error" class="editor-error">{{ error }}</div>

      <div v-if="loading" class="editor-loading">{{ t('sftp.loadingEllipsis') }}</div>

      <div v-else class="editor-body">
        <div ref="gutterRef" class="editor-gutter" aria-hidden="true">
          <span v-for="n in lineNumbers" :key="n" class="gutter-line">{{ n }}</span>
        </div>
        <textarea
          ref="editorRef"
          v-model="content"
          class="editor-textarea"
          spellcheck="false"
          :readonly="loadFailed"
          @input="dirty = true"
          @scroll="handleScroll"
        ></textarea>
      </div>

      <div class="editor-footer">
        <span class="editor-hint">{{ t('sftp.editorHint') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.editor-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.editor-modal {
  width: 720px;
  max-width: calc(100vw - 48px);
  height: 540px;
  max-height: calc(100vh - 48px);
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color);
  gap: 12px;
}

.editor-title-group {
  min-width: 0;
}

.editor-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.editor-path {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  display: block;
}

.editor-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.editor-dirty-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
}

.editor-save-btn {
  padding: 5px 14px;
  border: none;
  border-radius: 6px;
  background: var(--accent);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.editor-save-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.editor-save-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.editor-error {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--danger);
  background: rgba(248, 81, 73, 0.1);
  border-bottom: 1px solid var(--border-color);
}

.editor-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  font-size: 13px;
}

.editor-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.editor-gutter {
  flex-shrink: 0;
  width: 48px;
  padding: 12px 8px 12px 0;
  text-align: right;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  overflow: hidden;
  user-select: none;
  box-sizing: border-box;
}

.editor-gutter span.gutter-line {
  display: block;
  white-space: pre;
}

.editor-textarea {
  flex: 1;
  width: 100%;
  padding: 12px 16px;
  background: var(--bg-primary);
  border: none;
  color: var(--text-primary);
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.6;
  resize: none;
  outline: none;
  tab-size: 2;
}

.editor-footer {
  padding: 6px 16px;
  border-top: 1px solid var(--border-color);
  display: flex;
  align-items: center;
}

.editor-hint {
  font-size: 10px;
  color: var(--text-secondary);
}
</style>
