<script setup lang="ts">
import AppIcon from '../icons/AppIcon.vue'
import HostKeyMismatchDialog from '@/components/app/HostKeyMismatchDialog.vue'
import ConnectionFormBasic from './ConnectionFormBasic.vue'
import ConnectionFormTunnel from './ConnectionFormTunnel.vue'
import ConnectionFormAdvanced from './ConnectionFormAdvanced.vue'
import { computed, nextTick, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm, appPrompt } from '@/composables/app/useAppDialog'
import type { HostKeyMismatchData } from '@/domain/app/security'
import type { Connection, Group, SavedCredential } from '../../env.d.ts'
import type { ConnectionFormModel, ConnectionFormSection } from './connectionFormTypes'
import './connectionForm.css'

const props = defineProps<{
  connection: Connection | null
  defaultGroupId?: string
}>()

const emit = defineEmits<{
  (
    e: 'saved',
    connection: Connection,
    meta?: { continueCreating?: boolean },
  ): void
  (e: 'cancel'): void
  (e: 'credential-saved'): void
  /** Open app settings (e.g. network tab to install VcXsrv). */
  (e: 'open-settings', tab?: 'network'): void
}>()

const { t } = useI18n()

const form = ref<ConnectionFormModel>({
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
  jumpPrivateKey: '',
  useAgent: false,
  localForwards: [],
  remoteForwards: [],
  dynamicForwards: [],
})

const groups = ref<Group[]>([])
const savedCredentials = ref<SavedCredential[]>([])
const selectedCredentialId = ref('')
const credentialAutoFillEnabled = ref(false)
const saving = ref(false)
const showPassword = ref(false)
const privateKeyFileName = ref('')
const authType = ref<'password' | 'key'>('password')
const jumpAuthType = ref<'password' | 'key'>('password')
const jumpPrivateKeyFileName = ref('')
/** When editing, keep stored private key unless the user picks/clears one. */
const keepStoredPrivateKey = ref(false)
const keepStoredJumpPrivateKey = ref(false)
const formSection = ref<ConnectionFormSection>('basic')

const testingConnection = ref(false)
const basicRef = ref<{ nameInputRef?: HTMLInputElement | null } | null>(null)

/** Host-key trust prompt during “测试连接” (first contact / key change). */
const hostKeyDialogVisible = ref(false)
const hostKeyDialogData = ref<HostKeyMismatchData | null>(null)
let hostKeyDialogResolve: ((accepted: boolean) => void) | null = null

/** Edit existing vs create (new / copy without id). */
const isCreateMode = computed(() => !props.connection?.id)
/** Copy opens with a prefilled connection but empty id. */
const isCopyCreate = computed(() => !!props.connection && !props.connection.id)

const selectedCredential = computed(() => {
  return savedCredentials.value.find((credential) => credential.id === selectedCredentialId.value) || null
})

const tunnelConfigCount = computed(() => {
  let n = 0
  if (form.value.jumpHost.trim()) n += 1
  n += form.value.localForwards.filter((f) => f.localPort > 0 || f.remotePort > 0 || f.remoteHost.trim()).length
  n += form.value.remoteForwards.filter((f) => f.remotePort > 0 || f.localPort > 0).length
  n += form.value.dynamicForwards.filter((f) => f.localPort > 0).length
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
  const secretsPromise = props.connection?.id
    ? window.LiteConnect.getConnectionSecrets(props.connection.id)
    : Promise.resolve({
        password: props.connection?.password || '',
        privateKey: props.connection?.privateKey || '',
        jumpPassword: props.connection?.jumpPassword || '',
        jumpPrivateKey: props.connection?.jumpPrivateKey || '',
      })

  const [loadedGroups, loadedCredentials, autoFillEnabled, secrets] = await Promise.all([
    groupsPromise,
    savedCredentialsPromise,
    autoFillPromise,
    secretsPromise,
  ])
  const password = secrets.password
  groups.value = loadedGroups
  savedCredentials.value = loadedCredentials
  credentialAutoFillEnabled.value = autoFillEnabled
  const defaultGroupId =
    props.defaultGroupId
    || loadedGroups.find((g) => g.isDefault)?.id
    || loadedGroups[0]?.id
    || ''

  if (props.connection) {
    form.value = {
      name: props.connection.name,
      host: props.connection.host,
      port: props.connection.port,
      username: props.connection.username,
      password,
      privateKey: secrets.privateKey || '',
      group: props.connection.group || defaultGroupId,
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
      jumpPassword: secrets.jumpPassword || props.connection.jumpPassword || '',
      jumpPrivateKey: secrets.jumpPrivateKey || '',
      useAgent: props.connection.useAgent ?? false,
      localForwards: props.connection.localForwards
        ? props.connection.localForwards.map((f) => ({ ...f }))
        : [],
      remoteForwards: props.connection.remoteForwards
        ? props.connection.remoteForwards.map((f) => ({
            remoteHost: f.remoteHost || '127.0.0.1',
            remotePort: f.remotePort,
            localHost: f.localHost || '127.0.0.1',
            localPort: f.localPort,
          }))
        : [],
      dynamicForwards: props.connection.dynamicForwards
        ? props.connection.dynamicForwards.map((f) => ({ ...f }))
        : [],
    }
    if (props.connection.hasPrivateKey || secrets.privateKey) {
      authType.value = 'key'
      privateKeyFileName.value = t('connectionForm.keyLoaded')
      keepStoredPrivateKey.value = !secrets.privateKey && !!props.connection.id
      if (!props.connection.id && secrets.privateKey) {
        // Copy-as-new: keep key material in the form so save writes it
        keepStoredPrivateKey.value = false
      } else if (props.connection.id && (props.connection.hasPrivateKey || secrets.privateKey)) {
        form.value.privateKey = ''
        keepStoredPrivateKey.value = true
      }
    }
    if (props.connection.hasJumpPrivateKey || secrets.jumpPrivateKey) {
      jumpAuthType.value = 'key'
      jumpPrivateKeyFileName.value = t('connectionForm.keyLoaded')
      if (props.connection.id) {
        form.value.jumpPrivateKey = ''
        keepStoredJumpPrivateKey.value = true
      }
    } else if (secrets.jumpPassword || props.connection.hasJumpPassword) {
      jumpAuthType.value = 'password'
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
  } else {
    form.value.group = defaultGroupId
  }

  if (!props.connection && autoFillEnabled && loadedCredentials.length > 0) {
    selectedCredentialId.value = loadedCredentials[0].id
    await fillCredential(loadedCredentials[0])
  }
})

/** Next "Name (n)" for continuous copy / bulk create. */
function nextSequentialName(originalName: string): string {
  const trimmed = originalName.trim() || t('connectionForm.namePlaceholder')
  const match = trimmed.match(/^(.+?)\s*\((\d+)\)$/)
  if (match) {
    return `${match[1].trim()} (${parseInt(match[2], 10) + 1})`
  }
  return `${trimmed} (2)`
}

/** Keep form open after create; prepare fields for the next entry. */
async function prepareNextCreateForm(justSaved: Connection) {
  formSection.value = 'basic'
  if (isCopyCreate.value) {
    // Copy flow: keep credentials / tunnel, only bump the display name
    form.value.name = nextSequentialName(justSaved.name)
  } else {
    // Blank create: clear identity fields, keep group / auth / tunnel for batch entry
    form.value.name = ''
    form.value.host = ''
    form.value.note = ''
  }
  await nextTick()
  const nameInput = basicRef.value?.nameInputRef
  nameInput?.focus()
  nameInput?.select()
}

/**
 * @param continueCreating When true (create/copy only), keep the dialog open for the next host.
 */
async function handleSave(continueCreating = false) {
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
  if (authType.value === 'key' && !form.value.privateKey.trim() && !keepStoredPrivateKey.value) {
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
        const action = await appConfirm({
          title: t('connectionForm.graphicalForwarding'),
          message: t('x11.notFoundPrompt'),
          confirmText: t('connectionForm.goInstallX11'),
          tertiaryText: t('connectionForm.saveAnyway'),
          cancelText: t('common.cancel'),
          tone: 'warning',
        })
        if (action === 'confirm') {
          // Leave the form open so the user can save after installing.
          emit('open-settings', 'network')
          return
        }
        // action === 'tertiary' → save anyway
      }
    } catch (err) {
      // A cancelled warning must leave the form open; an unavailable status
      // probe must not prevent a connection from being saved.
      if (err === 'cancel') return
    }
  }

  const stayOpen = continueCreating === true && isCreateMode.value

  saving.value = true
  try {
    const data: any = {
      name: form.value.name.trim(),
      host: form.value.host.trim(),
      port: form.value.port,
      username: form.value.username.trim(),
      password: form.value.password,
      privateKey:
        authType.value === 'key'
          ? (form.value.privateKey.trim() || (keepStoredPrivateKey.value ? undefined : ''))
          : '',
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
      jumpPassword:
        form.value.jumpHost.trim()
          ? (jumpAuthType.value === 'password'
              ? (form.value.jumpPassword || undefined)
              : '')
          : undefined,
      jumpPrivateKey:
        form.value.jumpHost.trim()
          ? (jumpAuthType.value === 'key'
              ? (form.value.jumpPrivateKey.trim() || (keepStoredJumpPrivateKey.value ? undefined : ''))
              : '')
          : undefined,
      useAgent: form.value.useAgent,
      localForwards: form.value.localForwards.filter(
        (f) => f.localPort > 0 && f.remoteHost.trim() && f.remotePort > 0,
      ),
      remoteForwards: form.value.remoteForwards.filter(
        (f) => f.remotePort > 0 && f.localPort > 0,
      ),
      dynamicForwards: form.value.dynamicForwards.filter((f) => f.localPort > 0),
    }
    if (props.connection?.id) {
      data.id = props.connection.id
    }
    const saved = await window.LiteConnect.saveConnection(data)
    if (stayOpen) {
      ElMessage.success(t('connectionForm.addedContinue'))
      emit('saved', saved, { continueCreating: true })
      await prepareNextCreateForm(saved)
    } else {
      ElMessage.success(props.connection?.id ? t('connectionForm.updated') : t('connectionForm.added'))
      emit('saved', saved)
    }
  } catch (err: any) {
    ElMessage.error(err.message || t('connectionForm.saveFailed'))
  } finally {
    saving.value = false
  }
}

function promptHostKeyTrust(data: HostKeyMismatchData): Promise<boolean> {
  return new Promise((resolve) => {
    hostKeyDialogData.value = data
    hostKeyDialogVisible.value = true
    hostKeyDialogResolve = resolve
  })
}

function handleHostKeyDialogAccept() {
  hostKeyDialogVisible.value = false
  const resolve = hostKeyDialogResolve
  hostKeyDialogResolve = null
  hostKeyDialogData.value = null
  resolve?.(true)
}

function handleHostKeyDialogReject() {
  hostKeyDialogVisible.value = false
  const resolve = hostKeyDialogResolve
  hostKeyDialogResolve = null
  hostKeyDialogData.value = null
  resolve?.(false)
}

function buildTestParams() {
  return {
    host: form.value.host.trim(),
    port: form.value.port,
    username: form.value.username.trim(),
    password: form.value.password,
    privateKey: authType.value === 'key' ? form.value.privateKey.trim() || undefined : undefined,
    connectionId: props.connection?.id || undefined,
    jumpHost: form.value.jumpHost.trim() || undefined,
    jumpPort: form.value.jumpHost.trim() ? form.value.jumpPort || 22 : undefined,
    jumpUsername: form.value.jumpUsername?.trim() || undefined,
    jumpPassword: jumpAuthType.value === 'password' ? form.value.jumpPassword || undefined : undefined,
    jumpPrivateKey: jumpAuthType.value === 'key' ? form.value.jumpPrivateKey.trim() || undefined : undefined,
    useAgent: form.value.useAgent,
  }
}

function formatTestFailure(result: {
  stage?: string
  error?: string
  hostKeyUnknown?: boolean
}): string {
  if (result.stage === 'host_key' && result.hostKeyUnknown) {
    return t('connectionForm.testNeedTrust')
  }
  const stageKey = result.stage && ['tcp', 'ssh_handshake', 'host_key', 'auth', 'jump', 'shell'].includes(result.stage)
    ? result.stage
    : 'unknown'
  const stageLabel = t(`connectionForm.testStage.${stageKey}`)
  if (result.error) {
    return `${t('connectionForm.testFailed')}（${stageLabel}）：${result.error}`
  }
  return `${t('connectionForm.testFailed')}（${stageLabel}）`
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
  if (authType.value === 'key' && !form.value.privateKey.trim() && !keepStoredPrivateKey.value) {
    formSection.value = 'basic'
    ElMessage.warning(t('connectionForm.needPrivateKey'))
    return
  }

  testingConnection.value = true

  try {
    const params = buildTestParams()
    // Jump + target may each need one trust step on first contact.
    const maxAttempts = 3
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const result = await window.LiteConnect.sshDiagnoseConnectionParams(params)
      if (result.ok) {
        ElMessage.success(t('connectionForm.testSuccess'))
        return
      }

      const canTrust =
        result.stage === 'host_key' &&
        !!result.hostKeyBase64 &&
        !!result.hostKeyHost &&
        typeof result.hostKeyPort === 'number'

      if (!canTrust) {
        ElMessage.error(formatTestFailure(result))
        return
      }

      const accepted = await promptHostKeyTrust({
        connectionId: props.connection?.id || '__test__',
        host: result.hostKeyHost!,
        port: result.hostKeyPort!,
        existingFingerprint: result.existingFingerprint || '',
        newFingerprint: result.newFingerprint || '',
        role: result.hostKeyRole || 'target',
      })

      if (!accepted) {
        ElMessage.warning(
          result.hostKeyUnknown
            ? t('connectionForm.testTrustRejected')
            : t('connectionForm.testFailed'),
        )
        return
      }

      try {
        await window.LiteConnect.sshTrustHostKey(
          result.hostKeyHost!,
          result.hostKeyPort!,
          result.hostKeyBase64!,
        )
        ElMessage.success(t('connectionForm.hostKeyTrusted'))
      } catch (err: any) {
        ElMessage.error(err?.message || t('connectionForm.testFailed'))
        return
      }
      // Loop: re-run diagnose with the newly trusted host key.
    }
    ElMessage.error(t('connectionForm.testFailed'))
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
    keepStoredPrivateKey.value = false
  }
}

function clearPrivateKey() {
  form.value.privateKey = ''
  privateKeyFileName.value = ''
  keepStoredPrivateKey.value = false
  authType.value = 'password'
}

function switchAuthType(type: 'password' | 'key') {
  authType.value = type
  if (type === 'password') {
    form.value.privateKey = ''
    privateKeyFileName.value = ''
    keepStoredPrivateKey.value = false
  }
}

async function selectJumpPrivateKey() {
  const content = await window.LiteConnect.readPrivateKeyFile()
  if (content) {
    form.value.jumpPrivateKey = content
    jumpPrivateKeyFileName.value = t('connectionForm.keySelected')
    keepStoredJumpPrivateKey.value = false
    jumpAuthType.value = 'key'
  }
}

function clearJumpPrivateKey() {
  form.value.jumpPrivateKey = ''
  jumpPrivateKeyFileName.value = ''
  keepStoredJumpPrivateKey.value = false
  jumpAuthType.value = 'password'
}

function switchJumpAuthType(type: 'password' | 'key') {
  jumpAuthType.value = type
  if (type === 'password') {
    form.value.jumpPrivateKey = ''
    jumpPrivateKeyFileName.value = ''
    keepStoredJumpPrivateKey.value = false
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

      <form @submit.prevent="handleSave(false)" class="form">
        <div class="form-body">
          <ConnectionFormBasic
            v-show="formSection === 'basic'"
            ref="basicRef"
            :form="form"
            :groups="groups"
            :saved-credentials="savedCredentials"
            :selected-credential-id="selectedCredentialId"
            :auth-type="authType"
            :show-password="showPassword"
            :private-key-file-name="privateKeyFileName"
            :keep-stored-private-key="keepStoredPrivateKey"
            @update:selected-credential-id="selectedCredentialId = $event"
            @update:show-password="showPassword = $event"
            @apply-credential="applySavedCredential"
            @switch-auth="switchAuthType"
            @select-private-key="selectPrivateKey"
            @clear-private-key="clearPrivateKey"
          />
          <ConnectionFormTunnel
            v-show="formSection === 'tunnel'"
            :form="form"
            :jump-auth-type="jumpAuthType"
            :jump-private-key-file-name="jumpPrivateKeyFileName"
            @switch-jump-auth="switchJumpAuthType"
            @select-jump-key="selectJumpPrivateKey"
            @clear-jump-key="clearJumpPrivateKey"
          />
          <ConnectionFormAdvanced v-show="formSection === 'advanced'" :form="form" />
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
            <button
              v-if="isCreateMode"
              type="button"
              class="ui-btn"
              :disabled="saving"
              :title="t('connectionForm.saveAndContinueHint')"
              @click="handleSave(true)"
            >
              {{ saving ? t('common.saving') : t('connectionForm.saveAndContinue') }}
            </button>
            <button type="submit" class="ui-btn ui-btn-primary" :disabled="saving">
              {{ saving ? t('common.saving') : t('common.save') }}
            </button>
          </div>
        </footer>
      </form>
    </div>

    <HostKeyMismatchDialog
      v-if="hostKeyDialogVisible"
      :data="hostKeyDialogData"
      @accept="handleHostKeyDialogAccept"
      @reject="handleHostKeyDialogReject"
    />
  </div>
</template>

