<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import AppIcon from '../icons/AppIcon.vue'
import type { SavedCredential } from '../../env.d.ts'
import { appConfirm } from '../../composables/useAppDialog'

const { t } = useI18n()

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'changed'): void
}>()

const credentials = ref<SavedCredential[]>([])
const revealedPasswords = ref<Record<string, string>>({})
const loading = ref(false)
const saving = ref(false)
const formVisible = ref(false)
const passwordVisible = ref(false)
const form = ref({
  id: '',
  name: '',
  username: '',
  password: '',
})

const isEditing = computed(() => !!form.value.id)
const formTitle = computed(() => (isEditing.value ? t('credentials.editTitle') : t('credentials.addTitle')))
const countLabel = computed(() => {
  const n = credentials.value.length
  return n === 0 ? t('credentials.emptyCount') : t('credentials.savedCount', { n })
})

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      revealedPasswords.value = {}
      hideForm()
      await loadCredentials()
    }
  },
)

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})

function onKeydown(e: KeyboardEvent) {
  if (!props.modelValue) return
  if (e.key === 'Escape') {
    e.preventDefault()
    if (formVisible.value) {
      hideForm()
    } else {
      close()
    }
  }
}

function close() {
  emit('update:modelValue', false)
  revealedPasswords.value = {}
  hideForm()
}

async function loadCredentials() {
  loading.value = true
  try {
    credentials.value = await window.LiteConnect.getSavedCredentials()
  } finally {
    loading.value = false
  }
}

function hideForm() {
  formVisible.value = false
  passwordVisible.value = false
  form.value = { id: '', name: '', username: '', password: '' }
}

function startCreate() {
  form.value = { id: '', name: '', username: '', password: '' }
  passwordVisible.value = false
  formVisible.value = true
}

async function startEdit(credential: SavedCredential) {
  const password = await window.LiteConnect.getSavedCredentialPassword(credential.id)
  form.value = {
    id: credential.id,
    name: credential.name,
    username: credential.username,
    password,
  }
  passwordVisible.value = false
  formVisible.value = true
}

async function saveForm() {
  if (!form.value.name.trim()) {
    ElMessage.warning(t('credentials.needDisplayName'))
    return
  }
  if (!form.value.username.trim()) {
    ElMessage.warning(t('credentials.needUsername'))
    return
  }
  if (!form.value.password) {
    ElMessage.warning(t('credentials.needPassword'))
    return
  }

  saving.value = true
  try {
    await window.LiteConnect.saveSavedCredential({
      ...(form.value.id ? { id: form.value.id } : {}),
      name: form.value.name.trim(),
      username: form.value.username.trim(),
      password: form.value.password,
    })
    const wasEdit = !!form.value.id
    await loadCredentials()
    hideForm()
    emit('changed')
    ElMessage.success(wasEdit ? t('credentials.updated') : t('credentials.added'))
  } catch (err: any) {
    ElMessage.error(err.message || t('credentials.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function toggleReveal(credential: SavedCredential) {
  if (revealedPasswords.value[credential.id]) {
    const next = { ...revealedPasswords.value }
    delete next[credential.id]
    revealedPasswords.value = next
    return
  }
  const password = await window.LiteConnect.getSavedCredentialPassword(credential.id)
  revealedPasswords.value = {
    ...revealedPasswords.value,
    [credential.id]: password,
  }
}

async function removeCredential(credential: SavedCredential) {
  try {
    await appConfirm({
      title: t('credentials.deleteTitle'),
      message: t('credentials.deleteMessage', { name: credential.name }),
      detail: t('credentials.deleteDetail'),
      confirmText: t('common.delete'),
      danger: true,
      tone: 'danger',
    })
    await window.LiteConnect.deleteSavedCredential(credential.id)
    const next = { ...revealedPasswords.value }
    delete next[credential.id]
    revealedPasswords.value = next
    if (form.value.id === credential.id) hideForm()
    await loadCredentials()
    emit('changed')
    ElMessage.success(t('credentials.deleted'))
  } catch {}
}

function formatTime(value: number): string {
  if (!value) return '--'
  return new Date(value).toLocaleString()
}
</script>

<template>
  <div
    v-if="modelValue"
    class="ui-modal-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="credential-modal-title"
    @click.self="close"
  >
    <div class="ui-modal-card credential-modal">
      <button class="ui-modal-close" type="button" :aria-label="t('common.close')" @click="close">
        <AppIcon name="close" :size="14" />
      </button>

      <header class="modal-top">
        <div class="modal-top-text">
          <h3 id="credential-modal-title" class="modal-title">{{ t('credentials.title') }}</h3>
          <p class="modal-desc">
            {{ t('credentials.desc') }}
          </p>
          <p class="modal-count">{{ countLabel }}</p>
        </div>
        <button
          v-if="!formVisible"
          class="ui-btn ui-btn-primary"
          type="button"
          @click="startCreate"
        >
          <AppIcon name="plus" :size="14" />
          <span>{{ t('credentials.addAccount') }}</span>
        </button>
      </header>

      <div class="tip-card">
        <div class="tip-title">{{ t('credentials.howTo') }}</div>
        <ol class="tip-list">
          <li>{{ t('credentials.howTo1') }}</li>
          <li>{{ t('credentials.howTo2') }}</li>
          <li>{{ t('credentials.howTo3') }}</li>
        </ol>
        <p class="tip-note">
          {{ t('credentials.howToNote') }}
        </p>
      </div>

      <section v-if="formVisible" class="form-panel">
        <div class="form-panel-head">
          <h4 class="form-panel-title">{{ formTitle }}</h4>
          <button type="button" class="link-btn" @click="hideForm">{{ t('common.cancel') }}</button>
        </div>
        <form class="form-grid" @submit.prevent="saveForm">
          <label class="field">
            <span class="field-label">{{ t('credentials.displayName') }}</span>
            <input
              v-model="form.name"
              class="ui-input"
              :placeholder="t('credentials.displayNamePlaceholder')"
              maxlength="64"
            />
            <span class="field-hint">{{ t('credentials.displayNameHint') }}</span>
          </label>
          <label class="field">
            <span class="field-label">{{ t('credentials.sshUsername') }}</span>
            <input v-model="form.username" class="ui-input" :placeholder="t('credentials.usernamePlaceholder')" maxlength="64" />
          </label>
          <label class="field field-full">
            <span class="field-label">{{ t('credentials.password') }}</span>
            <div class="password-row">
              <input
                v-model="form.password"
                class="ui-input password-input"
                :type="passwordVisible ? 'text' : 'password'"
                :placeholder="t('credentials.passwordPlaceholder')"
              />
              <button type="button" class="toggle-btn" @click="passwordVisible = !passwordVisible">
                {{ passwordVisible ? t('credentials.hide') : t('credentials.show') }}
              </button>
            </div>
          </label>
          <div class="form-actions">
            <button type="button" class="ui-btn" @click="hideForm">{{ t('common.cancel') }}</button>
            <button type="submit" class="ui-btn ui-btn-primary" :disabled="saving">
              {{ saving ? t('common.saving') : (isEditing ? t('credentials.saveEdit') : t('credentials.addAccount')) }}
            </button>
          </div>
        </form>
      </section>

      <div v-if="loading" class="list-area loading-area">
        <div v-for="i in 3" :key="i" class="ui-skeleton skeleton-row"></div>
      </div>

      <div v-else-if="credentials.length === 0" class="list-area ui-empty empty-state">
        <div class="ui-empty-icon" aria-hidden="true">
          <AppIcon name="lock" :size="22" />
        </div>
        <p class="ui-empty-title">{{ t('credentials.emptyTitle') }}</p>
        <p class="ui-empty-desc">
          {{ t('credentials.emptyDesc') }}
        </p>
        <div class="ui-empty-actions">
          <button type="button" class="ui-btn ui-btn-primary" @click="startCreate">
            <AppIcon name="plus" :size="14" />
            {{ t('credentials.addFirst') }}
          </button>
        </div>
      </div>

      <div v-else class="list-area account-list">
        <article v-for="item in credentials" :key="item.id" class="account-card">
          <div class="account-avatar" aria-hidden="true">
            {{ (item.username || item.name || '?').slice(0, 1).toUpperCase() }}
          </div>
          <div class="account-body">
            <div class="account-name">{{ item.name }}</div>
            <div class="account-line">
              <span class="account-label">{{ t('credentials.userLabel') }}</span>
              <code class="account-code">{{ item.username }}</code>
            </div>
            <div class="account-line">
              <span class="account-label">{{ t('credentials.passwordLabel') }}</span>
              <code class="account-code">
                {{ revealedPasswords[item.id] ?? '••••••••' }}
              </code>
            </div>
            <div class="account-time">{{ t('credentials.updatedAt', { time: formatTime(item.updatedAt || item.createdAt) }) }}</div>
          </div>
          <div class="account-actions">
            <button type="button" class="action-btn" @click="startEdit(item)">{{ t('credentials.edit') }}</button>
            <button type="button" class="action-btn" @click="toggleReveal(item)">
              {{ revealedPasswords[item.id] ? t('credentials.hidePassword') : t('credentials.showPassword') }}
            </button>
            <button type="button" class="action-btn danger" @click="removeCredential(item)">{{ t('credentials.delete') }}</button>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.credential-modal {
  width: min(720px, calc(100vw - 32px));
  max-height: calc(100vh - 40px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 22px 24px 18px;
}

.modal-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding-right: 28px;
  margin-bottom: 14px;
  flex-shrink: 0;
}

.modal-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.modal-desc {
  margin: 8px 0 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-secondary);
  max-width: 48em;
}

.modal-count {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--accent);
  font-weight: 500;
}

.tip-card {
  flex-shrink: 0;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--accent-bg);
  margin-bottom: 14px;
}

.tip-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.tip-list {
  margin: 0;
  padding-left: 1.2em;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.65;
}

.tip-note {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.form-panel {
  flex-shrink: 0;
  margin-bottom: 14px;
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
}

.form-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.form-panel-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.link-btn {
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  padding: 0;
}

.link-btn:hover {
  color: var(--accent);
}

.form-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.field-full {
  grid-column: 1 / -1;
}

.field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.field-hint {
  font-size: 11px;
  color: var(--text-secondary);
  opacity: 0.9;
}

.password-row {
  display: flex;
}

.password-input {
  border-top-right-radius: 0 !important;
  border-bottom-right-radius: 0 !important;
  border-right: none !important;
}

.toggle-btn {
  width: 64px;
  flex-shrink: 0;
  border: 1px solid var(--border-color);
  border-radius: 0 6px 6px 0;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.toggle-btn:hover {
  color: var(--text-primary);
}

.form-actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}

.list-area {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.loading-area {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.skeleton-row {
  height: 88px;
  border-radius: 10px;
}

.empty-state {
  border: 1px dashed var(--border-color);
  border-radius: 12px;
  background: var(--bg-primary);
  padding: 36px 20px;
}

.account-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-right: 2px;
}

.account-card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: 10px;
  background: var(--bg-primary);
}

.account-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 700;
  font-size: 15px;
}

.account-body {
  flex: 1;
  min-width: 0;
}

.account-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.account-line {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 12px;
}

.account-label {
  color: var(--text-secondary);
  width: 2.5em;
  flex-shrink: 0;
}

.account-code {
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  color: var(--text-primary);
  word-break: break-all;
  background: transparent;
}

.account-time {
  margin-top: 6px;
  font-size: 11px;
  color: var(--text-secondary);
}

.account-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.action-btn {
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.action-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.action-btn.danger:hover {
  border-color: var(--danger);
  color: var(--danger);
}

@media (max-width: 640px) {
  .form-grid {
    grid-template-columns: 1fr;
  }

  .account-card {
    flex-direction: column;
  }

  .account-actions {
    flex-direction: row;
    flex-wrap: wrap;
  }
}
</style>
