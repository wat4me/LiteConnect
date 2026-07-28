<script setup lang="ts">
import AppIcon from '../icons/AppIcon.vue'
import { computed, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm, appPrompt } from '../../composables/useAppDialog'
import type { Connection, Group, SavedCredential } from '../../env.d.ts'
import { CONNECTION_COLOR_TAGS } from '../../utils/connectionTags'

const props = defineProps<{
  connection: Connection | null
  defaultGroupId?: string
}>()

const emit = defineEmits<{
  (e: 'saved', connection: Connection): void
  (e: 'cancel'): void
  (e: 'credential-saved'): void
}>()

const { t } = useI18n()

const form = ref({
  name: '',
  host: '',
  port: 22,
  username: '',
  password: '',
  privateKey: '',
  group: '' as string | undefined,
  note: '',
  colorTag: '',
  keepaliveInterval: 30,
  x11Forwarding: false,
  x11Host: '127.0.0.1',
  x11Display: 0,
  jumpHost: '',
  jumpPort: 22,
  jumpUsername: '',
  jumpPassword: '',
  useAgent: false,
  localForwards: [] as Array<{ localPort: number; remoteHost: string; remotePort: number }>,
})

const groups = ref<Group[]>([])
const savedCredentials = ref<SavedCredential[]>([])
const selectedCredentialId = ref('')
const credentialAutoFillEnabled = ref(false)
const saving = ref(false)
const showPassword = ref(false)
const privateKeyFileName = ref('')
const authType = ref<'password' | 'key'>('password')
/** Form sections to keep the modal short and scannable */
type FormSection = 'basic' | 'tunnel' | 'advanced'
const formSection = ref<FormSection>('basic')

const testingConnection = ref(false)

const selectedCredential = computed(() => {
  return savedCredentials.value.find((credential) => credential.id === selectedCredentialId.value) || null
})

const tunnelConfigCount = computed(() => {
  let n = 0
  if (form.value.jumpHost.trim()) n += 1
  n += form.value.localForwards.filter((f) => f.localPort > 0 || f.remotePort > 0 || f.remoteHost.trim()).length
  if (form.value.x11Forwarding) n += 1
  return n
})

const advancedConfigCount = computed(() => {
  let n = 0
  if (form.value.useAgent) n += 1
  if (form.value.keepaliveInterval && form.value.keepaliveInterval !== 30) n += 1
  return n
})

defineExpose({ createSavedCredential })

onMounted(async () => {
  const groupsPromise = window.LiteConnect.getGroups()
  const savedCredentialsPromise = window.LiteConnect.getSavedCredentials()
  const autoFillPromise = window.LiteConnect.getCredentialAutoFillEnabled()
  const passwordPromise = props.connection?.id
    ? window.LiteConnect.getConnectionPassword(props.connection.id)
    : Promise.resolve(props.connection?.password || '')

  const [loadedGroups, loadedCredentials, autoFillEnabled, password] = await Promise.all([
    groupsPromise,
    savedCredentialsPromise,
    autoFillPromise,
    passwordPromise,
  ])
  groups.value = loadedGroups
  savedCredentials.value = loadedCredentials
  credentialAutoFillEnabled.value = autoFillEnabled

  if (props.connection) {
    form.value = {
      name: props.connection.name,
      host: props.connection.host,
      port: props.connection.port,
      username: props.connection.username,
      password,
      privateKey: props.connection.privateKey || '',
      group: props.connection.group || '',
      note: props.connection.note || '',
      colorTag: props.connection.colorTag || '',
      keepaliveInterval: props.connection.keepaliveInterval
        ? Math.round(props.connection.keepaliveInterval / 1000)
        : 30,
      x11Forwarding: props.connection.x11Forwarding ?? false,
      x11Host: props.connection.x11Host || '127.0.0.1',
      x11Display: props.connection.x11Display ?? 0,
      jumpHost: props.connection.jumpHost || '',
      jumpPort: props.connection.jumpPort || 22,
      jumpUsername: props.connection.jumpUsername || '',
      jumpPassword: props.connection.jumpPassword || '',
      useAgent: props.connection.useAgent ?? false,
      localForwards: props.connection.localForwards
        ? props.connection.localForwards.map((f) => ({ ...f }))
        : [],
    }
    if (props.connection.privateKey) {
      authType.value = 'key'
      privateKeyFileName.value = t('connectionForm.keyLoaded')
    }
    // Open the section that already has advanced data when editing
    if (
      props.connection.jumpHost ||
      props.connection.x11Forwarding ||
      (props.connection.localForwards && props.connection.localForwards.length > 0)
    ) {
      formSection.value = 'tunnel'
    } else if (props.connection.useAgent || (props.connection.keepaliveInterval && props.connection.keepaliveInterval !== 30000)) {
      formSection.value = 'advanced'
    }
  } else if (props.defaultGroupId) {
    form.value.group = props.defaultGroupId
  }

  if (!props.connection && autoFillEnabled && loadedCredentials.length > 0) {
    selectedCredentialId.value = loadedCredentials[0].id
    await fillCredential(loadedCredentials[0])
  }
})

async function handleSave() {
  if (!form.value.name.trim()) {
    formSection.value = 'basic'
    ElMessage.warning(t('connectionForm.needName'))
    return
  }
  if (!form.value.host.trim()) {
    formSection.value = 'basic'
    ElMessage.warning(t('connectionForm.needHost'))
    return
  }
  if (!form.value.username.trim()) {
    formSection.value = 'basic'
    ElMessage.warning(t('connectionForm.needUsername'))
    return
  }
  if (authType.value === 'key' && !form.value.privateKey.trim()) {
    formSection.value = 'basic'
    ElMessage.warning(t('connectionForm.needPrivateKey'))
    return
  }
  if (form.value.x11Forwarding) {
    if (!form.value.x11Host.trim()) {
      formSection.value = 'tunnel'
      ElMessage.warning(t('connectionForm.needDisplayHost'))
      return
    }
    if (!Number.isInteger(form.value.x11Display) || form.value.x11Display < 0 || form.value.x11Display > 99) {
      formSection.value = 'tunnel'
      ElMessage.warning(t('connectionForm.needDisplayNumber'))
      return
    }
    try {
      const x11Status = await window.LiteConnect.getX11ServerStatus()
      if (x11Status.supported && !x11Status.resolvedExecutablePath) {
        await appConfirm({
          title: t('connectionForm.graphicalForwarding'),
          message: t('x11.notFound'),
          confirmText: t('common.save'),
          cancelText: t('common.cancel'),
          tone: 'warning',
        })
      }
    } catch (err) {
      // A cancelled warning must leave the form open; an unavailable status
      // probe must not prevent a connection from being saved.
      if (err === 'cancel') return
    }
  }

  saving.value = true
  try {
    const data: any = {
      name: form.value.name.trim(),
      host: form.value.host.trim(),
      port: form.value.port,
      username: form.value.username.trim(),
      password: form.value.password,
      privateKey: authType.value === 'key' ? form.value.privateKey.trim() || undefined : undefined,
      group: form.value.group || undefined,
      note: form.value.note.trim(),
      colorTag: form.value.colorTag || '',
      keepaliveInterval: (form.value.keepaliveInterval || 30) * 1000,
      x11Forwarding: form.value.x11Forwarding,
      x11Host: form.value.x11Forwarding ? form.value.x11Host.trim() : undefined,
      x11Display: form.value.x11Forwarding ? form.value.x11Display : undefined,
      jumpHost: form.value.jumpHost.trim() || undefined,
      jumpPort: form.value.jumpHost.trim() ? form.value.jumpPort || 22 : undefined,
      jumpUsername: form.value.jumpUsername.trim() || undefined,
      jumpPassword: form.value.jumpPassword || undefined,
      useAgent: form.value.useAgent,
      localForwards: form.value.localForwards.filter(
        (f) => f.localPort > 0 && f.remoteHost.trim() && f.remotePort > 0,
      ),
    }
    if (props.connection?.id) {
      data.id = props.connection.id
    }
    const saved = await window.LiteConnect.saveConnection(data)
    ElMessage.success(props.connection?.id ? t('connectionForm.updated') : t('connectionForm.added'))
    emit('saved', saved)
  } catch (err: any) {
    ElMessage.error(err.message || t('connectionForm.saveFailed'))
  } finally {
    saving.value = false
  }
}

async function handleConnectionTest() {
  if (!form.value.host.trim()) {
    formSection.value = 'basic'
    ElMessage.warning(t('connectionForm.needHost'))
    return
  }
  if (!form.value.username.trim()) {
    formSection.value = 'basic'
    ElMessage.warning(t('connectionForm.needUsername'))
    return
  }
  if (authType.value === 'key' && !form.value.privateKey.trim()) {
    formSection.value = 'basic'
    ElMessage.warning(t('connectionForm.needPrivateKey'))
    return
  }

  testingConnection.value = true

  try {
    const result = await window.LiteConnect.sshDiagnoseConnectionParams({
      host: form.value.host.trim(),
      port: form.value.port,
      username: form.value.username.trim(),
      password: form.value.password,
      privateKey: authType.value === 'key' ? form.value.privateKey.trim() || undefined : undefined,
      jumpHost: form.value.jumpHost.trim() || undefined,
      jumpPort: form.value.jumpHost.trim() ? form.value.jumpPort || 22 : undefined,
      jumpUsername: form.value.jumpUsername?.trim() || undefined,
      jumpPassword: form.value.jumpPassword || undefined,
      useAgent: form.value.useAgent,
    })
    if (result.ok) {
      ElMessage.success(t('connectionForm.testSuccess'))
    } else {
      ElMessage.error(t('connectionForm.testFailed'))
    }
  } catch {
    ElMessage.error(t('connectionForm.testFailed'))
  } finally {
    testingConnection.value = false
  }
}

async function selectPrivateKey() {
  const content = await window.LiteConnect.readPrivateKeyFile()
  if (content) {
    form.value.privateKey = content
    privateKeyFileName.value = t('connectionForm.keySelected')
  }
}

function clearPrivateKey() {
  form.value.privateKey = ''
  privateKeyFileName.value = ''
  authType.value = 'password'
}

function switchAuthType(type: 'password' | 'key') {
  authType.value = type
  if (type === 'password') {
    form.value.privateKey = ''
    privateKeyFileName.value = ''
  }
}

async function refreshSavedCredentials() {
  savedCredentials.value = await window.LiteConnect.getSavedCredentials()
}

async function fillCredential(credential: SavedCredential) {
  const password = await window.LiteConnect.getSavedCredentialPassword(credential.id)
  form.value.username = credential.username
  form.value.password = password
  authType.value = 'password'
}

async function applySavedCredential() {
  if (!selectedCredential.value) return
  await fillCredential(selectedCredential.value)
  ElMessage.success(t('connectionForm.credentialFilled'))
}

async function saveCurrentCredential() {
  if (!form.value.username.trim()) {
    ElMessage.warning(t('connectionForm.needUsername'))
    return
  }
  if (!form.value.password) {
    ElMessage.warning(t('connectionForm.needPassword'))
    return
  }
  await createSavedCredential(form.value.username.trim(), form.value.password)
}

async function createSavedCredential(defaultUsername = '', defaultPassword = '') {
  try {
    const nameValue = await appPrompt({
      title: t('connectionForm.saveCredentialTitle'),
      message: t('connectionForm.saveCredentialNameMsg'),
      confirmText: t('connectionForm.next'),
      inputValue: defaultUsername,
      inputPlaceholder: t('connectionForm.credentialNamePlaceholder'),
      requiredMessage: t('connectionForm.displayNameRequired'),
    })
    const usernameValue = await appPrompt({
      title: t('connectionForm.saveCredentialTitle'),
      message: t('connectionForm.sshUsername'),
      confirmText: t('connectionForm.next'),
      inputValue: defaultUsername || nameValue,
      requiredMessage: t('connectionForm.usernameRequired'),
    })
    const passwordValue = await appPrompt({
      title: t('connectionForm.saveCredentialTitle'),
      message: t('connectionForm.password'),
      confirmText: t('common.save'),
      inputValue: defaultPassword,
      inputType: 'password',
      required: false,
      inputPlaceholder: t('connectionForm.optionalEmpty'),
    })
    const saved = await window.LiteConnect.saveSavedCredential({
      name: nameValue,
      username: usernameValue,
      password: passwordValue || '',
    })
    await refreshSavedCredentials()
    selectedCredentialId.value = saved.id
    await applySavedCredential()
    emit('credential-saved')
    ElMessage.success(t('connectionForm.credentialSaved'))
  } catch {}
}

async function deleteSelectedCredential() {
  if (!selectedCredentialId.value) return
  await window.LiteConnect.deleteSavedCredential(selectedCredentialId.value)
  selectedCredentialId.value = ''
  await refreshSavedCredentials()
  ElMessage.success(t('connectionForm.credentialDeleted'))
}

async function toggleCredentialAutoFill() {
  await window.LiteConnect.setCredentialAutoFillEnabled(credentialAutoFillEnabled.value)
}
</script>

<template>
  <div class="ui-modal-overlay" @click.self="emit('cancel')">
    <div class="ui-modal-card connection-modal">
      <button class="ui-modal-close" @click="emit('cancel')" :title="t('common.close')">
        <AppIcon name="close" size="sm" />
      </button>

      <header class="modal-header">
        <h3 class="modal-title">{{ connection?.id ? t('connectionForm.editTitle') : t('connectionForm.newTitle') }}</h3>
        <nav class="section-tabs" :aria-label="t('connectionForm.sectionAria')">
          <button
            type="button"
            class="section-tab"
            :class="{ active: formSection === 'basic' }"
            @click="formSection = 'basic'"
          >
            {{ t('connectionForm.sectionBasic') }}
          </button>
          <button
            type="button"
            class="section-tab"
            :class="{ active: formSection === 'tunnel' }"
            @click="formSection = 'tunnel'"
          >
            {{ t('connectionForm.sectionTunnel') }}
            <span v-if="tunnelConfigCount > 0" class="section-badge">{{ tunnelConfigCount }}</span>
          </button>
          <button
            type="button"
            class="section-tab"
            :class="{ active: formSection === 'advanced' }"
            @click="formSection = 'advanced'"
          >
            {{ t('connectionForm.sectionAdvanced') }}
            <span v-if="advancedConfigCount > 0" class="section-badge">{{ advancedConfigCount }}</span>
          </button>
        </nav>
      </header>

      <form @submit.prevent="handleSave" class="form">
        <div class="form-body">
          <!-- 基本 -->
          <div v-show="formSection === 'basic'" class="form-section">
            <div class="form-row">
              <label class="label">{{ t('connectionForm.name') }}</label>
              <input v-model="form.name" :placeholder="t('connectionForm.namePlaceholder')" class="ui-input" />
            </div>

            <div class="form-row">
              <label class="label">{{ t('connectionForm.host') }}</label>
              <div class="host-row">
                <input v-model="form.host" :placeholder="t('connectionForm.hostPlaceholder')" class="ui-input host-input" />
                <input v-model.number="form.port" type="number" :placeholder="t('connectionForm.port')" class="ui-input port-input" />
              </div>
            </div>

            <div class="form-row">
              <label class="label">{{ t('connectionForm.username') }}</label>
              <div class="username-row">
                <input v-model="form.username" placeholder="root" class="ui-input username-input" />
                <select v-model="selectedCredentialId" class="ui-input credential-inline-select" :title="t('connectionForm.credentialSelectTitle')" @change="applySavedCredential">
                  <option value="">{{ t('connectionForm.selectCredential') }}</option>
                  <option v-for="credential in savedCredentials" :key="credential.id" :value="credential.id">
                    {{ credential.name }} / {{ credential.username }}
                  </option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <label class="label">{{ t('connectionForm.authType') }}</label>
              <div class="auth-tabs">
                <button type="button" class="auth-tab" :class="{ active: authType === 'password' }" @click="switchAuthType('password')">{{ t('connectionForm.password') }}</button>
                <button type="button" class="auth-tab" :class="{ active: authType === 'key' }" @click="switchAuthType('key')">{{ t('connectionForm.key') }}</button>
              </div>
            </div>

            <div v-if="authType === 'password'" class="form-row">
              <label class="label">{{ t('connectionForm.password') }}</label>
              <div class="password-row">
                <input v-model="form.password" :type="showPassword ? 'text' : 'password'" :placeholder="t('connectionForm.passwordPlaceholder')" class="ui-input password-input" />
                <button type="button" class="btn-toggle-password" @click="showPassword = !showPassword" :title="showPassword ? t('connectionForm.hidePassword') : t('connectionForm.showPassword')">
                  <AppIcon :name="showPassword ? 'eye-off' : 'eye'" size="md" />
                </button>
              </div>
            </div>

            <div v-if="authType === 'key'" class="form-row">
              <label class="label">{{ t('connectionForm.privateKey') }}</label>
              <div class="privatekey-row">
                <button type="button" class="btn-select-key" @click="selectPrivateKey">{{ privateKeyFileName || t('connectionForm.selectPrivateKey') }}</button>
                <button v-if="form.privateKey" type="button" class="btn-clear-key" @click="clearPrivateKey" :title="t('connectionForm.clearPrivateKey')">
                  <AppIcon name="close" size="sm" />
                </button>
              </div>
              <div class="hint-text">{{ t('connectionForm.privateKeyHint') }}</div>
              <div class="form-row nested-row">
                <label class="label">{{ t('connectionForm.passphrase') }}</label>
                <div class="password-row">
                  <input v-model="form.password" :type="showPassword ? 'text' : 'password'" :placeholder="t('connectionForm.passphrasePlaceholder')" class="ui-input password-input" />
                  <button type="button" class="btn-toggle-password" @click="showPassword = !showPassword" :title="showPassword ? t('connectionForm.hidePassword') : t('connectionForm.showPassword')">
                    <AppIcon :name="showPassword ? 'eye-off' : 'eye'" size="md" />
                  </button>
                </div>
              </div>
            </div>

            <div class="form-grid-2">
              <div class="form-row">
                <label class="label">{{ t('connectionForm.group') }}</label>
                <select v-model="form.group" class="ui-input select-input">
                  <option value="">{{ t('connectionForm.ungrouped') }}</option>
                  <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.name }}</option>
                </select>
              </div>
              <div class="form-row">
                <label class="label">{{ t('connectionForm.colorTag') }}</label>
                <div class="color-tag-options">
                  <button
                    v-for="tag in CONNECTION_COLOR_TAGS"
                    :key="tag.id || 'none'"
                    type="button"
                    class="color-tag-btn"
                    :class="{ active: form.colorTag === tag.id }"
                    :title="tag.label"
                    @click="form.colorTag = tag.id"
                  >
                    <span class="color-tag-swatch" :style="{ background: tag.color }"></span>
                  </button>
                </div>
              </div>
            </div>

            <div class="form-row">
              <label class="label">{{ t('connectionForm.note') }}</label>
              <input v-model="form.note" class="ui-input" :placeholder="t('connectionForm.notePlaceholder')" maxlength="200" />
            </div>
          </div>

          <!-- 隧道 -->
          <div v-show="formSection === 'tunnel'" class="form-section">
            <div class="form-row panel">
              <div class="panel-head">
                <span class="panel-title">{{ t('connectionForm.jumpTitle') }}</span>
                <span class="panel-hint">{{ t('connectionForm.jumpHint') }}</span>
              </div>
              <div class="x11-options">
                <div class="x11-field">
                  <label class="label">{{ t('connectionForm.jumpHost') }}</label>
                  <input v-model="form.jumpHost" class="ui-input" placeholder="bastion.example.com" />
                </div>
                <div class="x11-field x11-display-field">
                  <label class="label">{{ t('connectionForm.port') }}</label>
                  <input v-model.number="form.jumpPort" type="number" min="1" max="65535" class="ui-input" />
                </div>
              </div>
              <div v-if="form.jumpHost" class="x11-options">
                <div class="x11-field">
                  <label class="label">{{ t('connectionForm.jumpUser') }}</label>
                  <input v-model="form.jumpUsername" class="ui-input" :placeholder="t('connectionForm.jumpUserPlaceholder')" />
                </div>
                <div class="x11-field">
                  <label class="label">{{ t('connectionForm.jumpPassword') }}</label>
                  <input v-model="form.jumpPassword" type="password" class="ui-input" :placeholder="t('connectionForm.jumpPasswordPlaceholder')" />
                </div>
              </div>
            </div>

            <div class="form-row panel">
              <div class="panel-head">
                <span class="panel-title">{{ t('connectionForm.localForwardTitle') }}</span>
                <span class="panel-hint">{{ t('connectionForm.localForwardHint') }}</span>
              </div>
              <div
                v-for="(fwd, idx) in form.localForwards"
                :key="idx"
                class="forward-row"
              >
                <div class="x11-field x11-display-field">
                  <label class="label">{{ t('connectionForm.localPort') }}</label>
                  <input v-model.number="fwd.localPort" type="number" min="1" max="65535" class="ui-input" />
                </div>
                <div class="x11-field">
                  <label class="label">{{ t('connectionForm.remoteHost') }}</label>
                  <input v-model="fwd.remoteHost" class="ui-input" placeholder="127.0.0.1" />
                </div>
                <div class="x11-field x11-display-field">
                  <label class="label">{{ t('connectionForm.remotePort') }}</label>
                  <input v-model.number="fwd.remotePort" type="number" min="1" max="65535" class="ui-input" />
                </div>
                <button type="button" class="btn-icon-remove" :title="t('common.delete')" @click="form.localForwards.splice(idx, 1)">{{ t('connectionForm.removeShort') }}</button>
              </div>
              <button
                type="button"
                class="btn-add-row"
                @click="form.localForwards.push({ localPort: 0, remoteHost: '127.0.0.1', remotePort: 0 })"
              >
                {{ t('connectionForm.addForward') }}
              </button>
            </div>

            <div class="form-row panel">
              <label class="checkbox-row">
                <input v-model="form.x11Forwarding" type="checkbox" />
                <span>{{ t('connectionForm.graphicalForwarding') }}</span>
              </label>
              <div class="hint-text">
                {{ t('connectionForm.graphicalHint') }}
              </div>
              <div v-if="form.x11Forwarding" class="x11-options">
                <div class="x11-field">
                  <label class="label">{{ t('connectionForm.displayHost') }}</label>
                  <input v-model="form.x11Host" placeholder="127.0.0.1" class="ui-input" />
                </div>
                <div class="x11-field x11-display-field">
                  <label class="label">{{ t('connectionForm.displayNumber') }}</label>
                  <input v-model.number="form.x11Display" type="number" min="0" max="99" placeholder="0" class="ui-input" />
                </div>
              </div>
              <div v-if="form.x11Forwarding" class="hint-text">
                {{ t('connectionForm.willConnect', {
                  host: form.x11Host || '127.0.0.1',
                  port: 6000 + (Number.isInteger(form.x11Display) ? form.x11Display : 0),
                }) }}
              </div>
            </div>
          </div>

          <!-- 高级 -->
          <div v-show="formSection === 'advanced'" class="form-section">
            <div class="form-row">
              <label class="label">{{ t('connectionForm.keepalive') }}</label>
              <input v-model.number="form.keepaliveInterval" type="number" min="5" max="300" placeholder="30" class="ui-input input-narrow" />
              <div class="hint-text">{{ t('connectionForm.keepaliveHint') }}</div>
            </div>

            <div class="form-row panel">
              <label class="checkbox-row">
                <input v-model="form.useAgent" type="checkbox" />
                <span>{{ t('connectionForm.useAgent') }}</span>
              </label>
              <div class="hint-text">{{ t('connectionForm.useAgentHint') }}</div>
            </div>
          </div>

        </div>

        <footer class="form-footer">
          <div class="form-actions-left">
            <button type="button" class="ui-btn ui-btn-sm" :disabled="testingConnection" @click="handleConnectionTest">
              <template v-if="testingConnection">
                <span class="spinner"></span> {{ t('connectionForm.testing') }}
              </template>
              <template v-else>
                {{ t('connectionForm.testConnection') }}
              </template>
            </button>
          </div>
          <div class="form-actions-right">
            <button type="button" class="ui-btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
            <button type="submit" class="ui-btn ui-btn-primary" :disabled="saving">
              {{ saving ? t('common.saving') : t('common.save') }}
            </button>
          </div>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.connection-modal {
  width: 480px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 32px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
}

.modal-header {
  flex-shrink: 0;
  padding: 20px 24px 0;
}

.modal-title {
  font-size: 18px;
  font-weight: 600;
  margin: 0 28px 14px 0;
  color: var(--text-primary);
}

.section-tabs {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
}

.section-tab {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.section-tab:hover:not(.active) {
  color: var(--text-primary);
  background: var(--bg-tertiary);
}

.section-tab.active {
  background: var(--accent);
  color: #fff;
}

.section-badge {
  min-width: 16px;
  height: 16px;
  padding: 0 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
  color: inherit;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}

.section-tab:not(.active) .section-badge {
  background: var(--accent-bg, rgba(56, 139, 253, 0.15));
  color: var(--accent);
}

.form {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.form-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 24px;
}

.form-section {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.nested-row {
  margin-top: 8px;
}

.panel {
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  gap: 10px;
}

.panel-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.panel-hint {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.forward-row {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.btn-icon-remove {
  height: 38px;
  padding: 0 10px;
  flex-shrink: 0;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.btn-icon-remove:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.btn-add-row {
  align-self: flex-start;
  padding: 6px 12px;
  background: none;
  border: 1px dashed var(--border-color);
  border-radius: 6px;
  color: var(--accent);
  font-size: 13px;
  cursor: pointer;
}

.btn-add-row:hover {
  border-color: var(--accent);
  background: var(--accent-bg, rgba(56, 139, 253, 0.08));
}

.input-narrow {
  width: 120px;
}

.form-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 24px 16px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.label {
  font-size: var(--font-ui-sm, 12px);
  color: var(--text-secondary);
  font-weight: 600;
}

.auth-tabs {
  display: flex;
  gap: 0;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  overflow: hidden;
}

.auth-tab {
  flex: 1;
  padding: 8px 0;
  background: var(--bg-primary);
  border: none;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.auth-tab:first-child {
  border-right: 1px solid var(--border-color);
}

.auth-tab.active {
  background: var(--accent);
  color: #fff;
}

.auth-tab:hover:not(.active) {
  background: var(--bg-tertiary);
}

.username-row {
  display: flex;
  gap: 8px;
}

.username-input {
  flex: 1;
}

.credential-inline-select {
  width: 170px;
  cursor: pointer;
}

.btn-credential {
  height: var(--control-h, 36px);
  padding: 0 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
}

.btn-credential:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.btn-credential:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.privatekey-row {
  display: flex;
  gap: 6px;
  align-items: center;
}

.btn-select-key {
  flex: 1;
  padding: 10px 12px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 14px;
  cursor: pointer;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: border-color 0.2s;
}

.btn-select-key:hover {
  border-color: var(--accent);
}

.btn-clear-key {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h, 36px);
  height: var(--control-h, 36px);
  background: none;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 8px);
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.15s;
}

.btn-clear-key:hover {
  color: var(--danger);
  border-color: var(--danger);
}

.host-row {
  display: flex;
  gap: 8px;
}

.password-row {
  display: flex;
  gap: 0;
}

.password-input {
  flex: 1;
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  border-right: none;
}

.btn-toggle-password {
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--control-h, 36px);
  height: var(--control-h, 36px);
  padding: 0;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-top-right-radius: var(--radius-md, 8px);
  border-bottom-right-radius: var(--radius-md, 8px);
  color: var(--text-secondary);
  cursor: pointer;
  transition: color 0.15s;
}

.btn-toggle-password:hover {
  color: var(--text-primary);
}

.host-input {
  flex: 1;
}

.port-input {
  width: 100px;
}

.select-input {
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%238b949e' d='M6 8L1 3h10z'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  padding-right: 32px;
  cursor: pointer;
}

.select-input option {
  background: var(--bg-secondary);
  color: var(--text-primary);
}

.checkbox-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  color: var(--text-primary);
  cursor: pointer;
}

.checkbox-row input {
  margin: 0;
}

.color-tag-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.color-tag-btn {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
}

.color-tag-btn.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-bg);
}

.color-tag-swatch {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.hint-text {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.x11-options {
  display: flex;
  gap: 8px;
}

.x11-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.x11-display-field {
  flex: 0 0 100px;
}

.form-actions-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-width: 0;
}

.form-actions-right {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

@media (max-width: 520px) {
  .form-grid-2 {
    grid-template-columns: 1fr;
  }

  .form-footer {
    flex-direction: column;
    align-items: stretch;
  }

  .form-actions-left,
  .form-actions-right {
    width: 100%;
    justify-content: stretch;
  }

  .form-actions-right .ui-btn {
    flex: 1;
  }

  .forward-row {
    flex-wrap: wrap;
  }
}

.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid var(--border-color);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
