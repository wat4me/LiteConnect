<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick, computed } from 'vue'
import { useI18n } from 'vue-i18n'

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
  loading.value = true
  error.value = ''
  try {
    content.value = await window.LiteConnect.sftpReadFile(props.sessionId, props.remotePath)
  } catch (err: any) {
    error.value = err.message || t('sftp.readFileFailed')
    content.value = ''
  } finally {
    loading.value = false
    await nextTick()
    editorRef.value?.focus()
  }
}

async function saveFile() {
  saving.value = true
  error.value = ''
  try {
    await window.LiteConnect.sftpWriteFile(props.sessionId, props.remotePath, content.value)
    dirty.value = false
    emit('saved')
  } catch (err: any) {
    error.value = err.message || t('sftp.saveFailed')
  } finally {
    saving.value = false
  }
}

function handleKeydown(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') {
    e.preventDefault()
    if (dirty.value && !saving.value) {
      saveFile()
    }
  }
  if (e.key === 'Escape') {
    emit('close')
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
  <div v-if="visible" class="editor-overlay" @click.self="emit('close')">
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
            :disabled="saving || !dirty"
            @click="saveFile"
          >
            {{ saving ? t('sftp.saving') : t('common.save') }}
          </button>
          <button class="editor-close" @click="emit('close')" :title="t('common.close')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
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

.editor-close {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.editor-close:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
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
