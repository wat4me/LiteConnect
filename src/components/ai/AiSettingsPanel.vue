<script setup lang="ts">
import { defaultAiProviderBaseUrl, normalizeAiProviderProtocol } from '@shared/aiProviderProtocol'
import type { AiProviderProtocol } from '@shared/types/ai'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiModel, AiProvider, AiSettings, AiToolPermissionMode } from '../../env.d.ts'
import { DEFAULT_SYSTEM_PROMPT } from '@/utils/shared/constants'
import { DEFAULT_AI_TOOL_PERMISSION, sanitizeAiToolPermission } from '@shared/aiToolPolicy'
import { firstAiModelId, modelContextSource, parseAiModels } from '@shared/aiContext'
import type { AiDiscoveredModel } from '@shared/types/ai'
import { normalizeAiToolRounds, MAX_AI_TOOL_ROUNDS } from '@shared/aiToolLimits'
import {
  MAX_AI_HISTORY_MAX_MESSAGES,
  MAX_AI_HISTORY_MAX_THREADS,
  MIN_AI_HISTORY_MAX_MESSAGES,
  MIN_AI_HISTORY_MAX_THREADS,
  normalizeAiHistoryMaxMessages,
  normalizeAiHistoryMaxThreads,
} from '@shared/aiHistoryLimits'
import AppIcon from '../icons/AppIcon.vue'
import AiModelPicker from './AiModelPicker.vue'
import { appConfirm } from '@/composables/app/useAppDialog'
import type { AiHistoryPrunePreview } from '@shared/aiHistoryLimits'

const { t } = useI18n()

const props = defineProps<{
  modelValue?: AiSettings
  layout?: 'page' | 'panel'
}>()

const emit = defineEmits<{
  (e: 'saved', settings: AiSettings): void
  (e: 'close'): void
}>()

function cloneSettings(settings?: AiSettings | null): AiSettings {
  const raw = settings
    ? (JSON.parse(JSON.stringify(settings)) as AiSettings)
    : {
        providers: [] as AiProvider[],
        activeProviderId: null,
        activeModel: '',
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        temperature: 0.7,
        toolPermission: DEFAULT_AI_TOOL_PERMISSION,
      }
  raw.providers = (raw.providers || []).map((p) => ({
    ...p,
    protocol: normalizeAiProviderProtocol(p.protocol),
    models: parseAiModels(p.models),
  }))
  raw.maxToolRounds = normalizeAiToolRounds(raw.maxToolRounds)
  raw.toolPermission = sanitizeAiToolPermission(raw.toolPermission)
  raw.approvalNotifications = raw.approvalNotifications !== false
  raw.historyMaxThreads = normalizeAiHistoryMaxThreads(raw.historyMaxThreads)
  raw.historyMaxMessages = normalizeAiHistoryMaxMessages(raw.historyMaxMessages)
  return raw
}

const permissionModes: Array<{ id: AiToolPermissionMode; label: string; desc: string }> = [
  { id: 'ask', label: t('ai.toolPermissionAsk'), desc: t('ai.toolPermissionAskDesc') },
  { id: 'readonly', label: t('ai.toolPermissionReadonly'), desc: t('ai.toolPermissionReadonlyDesc') },
  { id: 'auto', label: t('ai.toolPermissionAuto'), desc: t('ai.toolPermissionAutoDesc') },
]

const persistedSettings = ref<AiSettings>(cloneSettings(props.modelValue))
const draftSettings = ref<AiSettings>(cloneSettings(props.modelValue))
const providerDraft = ref<AiProvider | null>(null)
const editingProviderId = ref<string | null>(null)
const testingProvider = ref(false)
const saving = ref(false)
const showApiKey = ref(false)
const fetchingModels = ref(false)
const fetchedModels = ref<string[] | null>(null)
const discoveredModels = ref<AiDiscoveredModel[]>([])
const showModelPicker = ref(false)
const modelFetchButton = ref<HTMLButtonElement | null>(null)
const fetchError = ref('')
watch(editingProviderId, () => { fetchedModels.value = null; fetchError.value = ''; showModelPicker.value = false })
async function fetchModels() {
  const provider = editingProvider.value
  if (!provider || fetchingModels.value) return
  showModelPicker.value = true
  fetchingModels.value = true
  fetchError.value = ''
  fetchedModels.value = null
  const baseUrl = provider.baseUrl
  const apiKey = provider.apiKey
  const protocol = provider.protocol
  try {
    const models = await window.LiteConnect.listAiModels({ baseUrl, apiKey, protocol })
    if (editingProvider.value === provider && provider.baseUrl === baseUrl && provider.apiKey === apiKey && provider.protocol === protocol) {
      discoveredModels.value = models
      fetchedModels.value = models.map(model => model.id)
      for (const model of provider.models) {
        const match = models.find(item => item.id === model.id.trim())
        model.contextMetadata = match?.contextWindowTokens ? { modelId: match.id, tokens: match.contextWindowTokens } : undefined
      }
    }
  } catch (error: any) {
    if (editingProvider.value === provider) fetchError.value = error?.message || t('ai.fetchModelsFailed')
  } finally { fetchingModels.value = false }
}
function addSelectedModels(ids: string[]) {
  const provider = editingProvider.value
  if (!provider) return
  for (const id of ids) if (!provider.models.some(model => model.id.trim() === id)) {
    const found = discoveredModels.value.find(model => model.id === id)
    provider.models.push({ id, ...(found?.contextWindowTokens ? { contextMetadata: { modelId: id, tokens: found.contextWindowTokens } } : {}) })
  }
  fetchedModels.value = null
  showModelPicker.value = false
}
function makeDefaultModel(model: AiModel) {
  const provider = editingProvider.value
  if (!provider || !model.id.trim()) return
  provider.models = [model, ...provider.models.filter(m => m !== model)]
  providerDefaultChanged.value = true
}
const newProviderId = ref<string | null>(null)

watch(editingProviderId, () => { showApiKey.value = false })

type SettingsSection = 'providers' | 'conversation' | 'permissions' | 'notifications'
const section = ref<SettingsSection>('providers')
const isPanel = computed(() => props.layout === 'panel')
const panelOverview = ref(true)
const showingOverview = computed(() => isPanel.value && panelOverview.value && !editingProvider.value)
const settingsRoot = ref<HTMLElement | null>(null)
const sections: Array<{ id: SettingsSection; icon: 'models' | 'history' | 'shield' | 'bell'; label: string }> = [
  { id: 'providers', icon: 'models', label: t('ai.settingsUi.modelsAndApi') },
  { id: 'conversation', icon: 'history', label: t('ai.settingsUi.conversation') },
  { id: 'permissions', icon: 'shield', label: t('ai.settingsUi.execution') },
  { id: 'notifications', icon: 'bell', label: t('ai.settingsUi.notifications') },
]
const editingProvider = computed(() => providerDraft.value)
const providerDefaultChanged = ref(false)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function generalSnapshot(settings: AiSettings) {
  const rest = cloneSettings(settings)
  delete rest.historyMaxThreads
  delete rest.historyMaxMessages
  return rest
}
const generalDirty = computed(() => !same(generalSnapshot(draftSettings.value), generalSnapshot(persistedSettings.value)))
const historyDirty = computed(() => normalizeAiHistoryMaxThreads(draftSettings.value.historyMaxThreads) !== persistedSettings.value.historyMaxThreads || normalizeAiHistoryMaxMessages(draftSettings.value.historyMaxMessages) !== persistedSettings.value.historyMaxMessages)
const providerDirty = computed(() => !!editingProvider.value && !same(editingProvider.value, draftSettings.value.providers.find(provider => provider.id === editingProviderId.value)))
const hasChanges = computed(() => editingProvider.value ? providerDirty.value : section.value === 'conversation' ? historyDirty.value : generalDirty.value)
const anyChanges = computed(() => generalDirty.value || historyDirty.value || providerDirty.value)
const sectionSummaries = computed(() => ({
  providers: draftSettings.value.providers.find(provider => provider.id === draftSettings.value.activeProviderId)?.name || t('ai.noProviders'),
  conversation: t('ai.settingsUi.historySummary', { threads: normalizeAiHistoryMaxThreads(draftSettings.value.historyMaxThreads), messages: normalizeAiHistoryMaxMessages(draftSettings.value.historyMaxMessages) }),
  permissions: permissionModes.find(mode => mode.id === draftSettings.value.toolPermission)?.label || '',
  notifications: t(draftSettings.value.approvalNotifications ? 'ai.settingsUi.notificationsOn' : 'ai.settingsUi.notificationsOff'),
}))
const sectionChanges = computed(() => ({
  providers: !same(draftSettings.value.providers, persistedSettings.value.providers) || draftSettings.value.activeProviderId !== persistedSettings.value.activeProviderId || draftSettings.value.activeModel !== persistedSettings.value.activeModel,
  conversation: historyDirty.value,
  permissions: draftSettings.value.toolPermission !== persistedSettings.value.toolPermission || draftSettings.value.maxToolRounds !== persistedSettings.value.maxToolRounds,
  notifications: draftSettings.value.approvalNotifications !== persistedSettings.value.approvalNotifications,
}))
async function openSection(id: SettingsSection) {
  section.value = id
  panelOverview.value = false
  if (isPanel.value) {
    await nextTick()
    settingsRoot.value?.querySelector<HTMLButtonElement>('.settings-panel-header > button')?.focus()
  }
}
const cleanupPreview = ref<AiHistoryPrunePreview | null>(null)
const previewBusy = ref(false)
const previewError = ref('')
let previewVersion = 0
let previewTimer: ReturnType<typeof setTimeout> | undefined
function historyLimits() { return { maxThreads: normalizeAiHistoryMaxThreads(draftSettings.value.historyMaxThreads), maxMessages: normalizeAiHistoryMaxMessages(draftSettings.value.historyMaxMessages) } }
async function refreshPreview() {
  const version = ++previewVersion
  previewBusy.value = true
  previewError.value = ''
  try {
    const result = await window.LiteConnect.previewAiHistoryPrune(historyLimits())
    if (version === previewVersion) cleanupPreview.value = result
    return result
  } catch (error: any) {
    if (version === previewVersion) { cleanupPreview.value = null; previewError.value = error?.message || t('ai.settingsUi.previewFailed') }
    throw error
  } finally { if (version === previewVersion) previewBusy.value = false }
}
watch(() => [section.value, draftSettings.value.historyMaxThreads, draftSettings.value.historyMaxMessages], () => {
  clearTimeout(previewTimer)
  ++previewVersion
  cleanupPreview.value = null
  previewBusy.value = false
  if (section.value === 'conversation' && historyDirty.value) {
    previewBusy.value = true
    previewTimer = setTimeout(() => { void refreshPreview().catch(() => {}) }, 250)
  }
})
onBeforeUnmount(() => { clearTimeout(previewTimer); ++previewVersion })
function openProvider(provider: AiProvider) {
  editingProviderId.value = provider.id
  providerDraft.value = JSON.parse(JSON.stringify(provider))
  providerDefaultChanged.value = false
}
async function goBack() {
  if (saving.value || testingProvider.value) return
  if (isPanel.value && !editingProvider.value && !panelOverview.value) {
    const previous = section.value
    panelOverview.value = true
    section.value = 'providers'
    await nextTick()
    settingsRoot.value?.querySelector<HTMLButtonElement>(`.settings-category[data-section="${previous}"]`)?.focus()
    return
  }
  if (editingProvider.value ? providerDirty.value : generalDirty.value || historyDirty.value) {
    try { await appConfirm({ title: t('ai.settingsUi.unsaved'), message: t('ai.settingsUi.discardMessage'), confirmText: t('ai.settingsUi.discard'), cancelText: t('ai.settingsUi.keepEditing') }) } catch { return }
  }
  if (editingProviderId.value) { editingProviderId.value = null; providerDraft.value = null; newProviderId.value = null }
  else emit('close')
}
watch(() => props.modelValue, value => {
  if (!value || saving.value || editingProvider.value || generalDirty.value || historyDirty.value) return
  persistedSettings.value = cloneSettings(value)
  draftSettings.value = cloneSettings(value)
})
watch(() => [editingProvider.value?.baseUrl, editingProvider.value?.apiKey, editingProvider.value?.protocol], () => {
  fetchedModels.value = null
  fetchError.value = ''
  showModelPicker.value = false
})
watch(() => [editingProvider.value?.id, editingProvider.value?.baseUrl], (value, previous) => {
  if (value[0] === previous[0] && value[1] !== previous[1] && editingProvider.value) for (const model of editingProvider.value.models) model.contextMetadata = undefined
}, { flush: 'sync' })

function generateProviderId(): string {
  return `prov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function changeProviderProtocol(event: Event) {
  const provider = editingProvider.value
  if (!provider) return
  const previous = normalizeAiProviderProtocol(provider.protocol)
  const next = normalizeAiProviderProtocol((event.target as HTMLSelectElement).value)
  if (!provider.baseUrl.trim() || provider.baseUrl.trim() === defaultAiProviderBaseUrl(previous)) provider.baseUrl = defaultAiProviderBaseUrl(next)
  provider.protocol = next
  for (const model of provider.models) model.contextMetadata = undefined
}

function addProvider() {
  const newProvider: AiProvider = {
    id: generateProviderId(),
    name: t('ai.newProvider'),
    protocol: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    models: [],
  }
  openProvider(newProvider)
  newProviderId.value = newProvider.id
}

function deleteProvider(id: string) {
  const idx = draftSettings.value.providers.findIndex((p) => p.id === id)
  if (idx === -1) return
  draftSettings.value.providers.splice(idx, 1)
  if (draftSettings.value.activeProviderId === id) {
    draftSettings.value.activeProviderId = draftSettings.value.providers[0]?.id || null
    const firstP = draftSettings.value.providers[0]
    draftSettings.value.activeModel = firstAiModelId(firstP?.models)
  }
  if (editingProviderId.value === id) {
    editingProviderId.value = null
  }
}

function addModelToProvider(provider: AiProvider) {
  provider.models.push({ id: '' })
}

function modelWindowValue(model: AiModel): string {
  return model.contextWindowTokens ? String(model.contextWindowTokens) : ''
}

function modelWindowPlaceholder(model: AiModel): string {
  const context = modelContextSource({ ...model, contextWindowTokens: undefined })
  return context.source === 'fallback' ? t('ai.contextWindowAuto') : String(context.tokens)
}

function modelWindowSourceLabel(model: AiModel): string {
  const context = modelContextSource(model)
  return t(`ai.contextSource${context.source[0].toUpperCase()}${context.source.slice(1)}`, { tokens: context.tokens })
}

function setModelWindowValue(model: AiModel, raw: string) {
  const n = Number(raw)
  if (!raw.trim() || !Number.isFinite(n) || n <= 0) {
    model.contextWindowTokens = undefined
    return
  }
  model.contextWindowTokens = Math.round(n)
}

function setModelBudget(model: AiModel, key: 'maxOutputTokens' | 'compactionRetainTokens', raw: string) {
  const value = Number(raw)
  model[key] = raw.trim() && Number.isFinite(value) && value > 0 ? Math.min(4_000_000, Math.round(value)) : undefined
}

function setActiveProvider(provider: AiProvider) {
  draftSettings.value.activeProviderId = provider.id
  draftSettings.value.activeModel = firstAiModelId(provider.models)
}

function removeModelFromProvider(provider: AiProvider, index: number) {
  provider.models.splice(index, 1)
}

async function testProvider() {
  const provider = editingProvider.value
  if (!provider || testingProvider.value) return
  const model = firstAiModelId(provider.models)
  if (!model) {
    ElMessage.warning(t('ai.testProviderNeedModel'))
    return
  }
  testingProvider.value = true
  try {
    await window.LiteConnect.testAiProvider({
      baseUrl: provider.baseUrl.trim(),
      protocol: provider.protocol,
      apiKey: provider.apiKey,
      model,
    })
    ElMessage.success(t('ai.testProviderSuccess'))
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.testProviderFailed'))
  } finally {
    testingProvider.value = false
  }
}

async function saveSettings() {
  if (saving.value || !hasChanges.value) return
  const provider = editingProvider.value
  const scope = provider ? 'provider' : section.value === 'conversation' ? 'history' : 'general'
  saving.value = true
  try {
    const current = cloneSettings(await window.LiteConnect.getAiSettings())
    let next = cloneSettings(current)
    if (provider) {
      const cleaned = { ...JSON.parse(JSON.stringify(provider)), name: provider.name.trim() || t('ai.unnamedProvider'), baseUrl: provider.baseUrl.trim(), protocol: normalizeAiProviderProtocol(provider.protocol), models: parseAiModels(provider.models) } as AiProvider
      if (!cleaned.models.length) { ElMessage.warning(t('ai.needModel')); return }
      if (!cleaned.baseUrl) { ElMessage.warning(t('ai.needBaseUrl')); return }
      const index = next.providers.findIndex(item => item.id === provider.id)
      if (index >= 0) next.providers[index] = cleaned
      else next.providers.push(cleaned)
      if (next.activeProviderId === provider.id && providerDefaultChanged.value) next.activeModel = firstAiModelId(cleaned.models)
    } else if (scope === 'history') {
      clearTimeout(previewTimer)
      const preview = await refreshPreview()
      if (preview.conversations || preview.messages) {
        try { await appConfirm({ title: t('ai.settingsUi.applyHistory'), message: t('ai.settingsUi.cleanupConfirm', preview), detail: t('ai.settingsUi.cleanupDetail'), confirmText: t('ai.settingsUi.applyAndClean'), danger: true, tone: 'warning' }) } catch { return }
      }
      next.historyMaxThreads = historyLimits().maxThreads
      next.historyMaxMessages = historyLimits().maxMessages
    } else {
      next = cloneSettings(draftSettings.value)
      next.historyMaxThreads = current.historyMaxThreads
      next.historyMaxMessages = current.historyMaxMessages
    }
    if (!next.providers.some(item => item.id === next.activeProviderId)) next.activeProviderId = next.providers[0]?.id || null
    const active = next.providers.find(item => item.id === next.activeProviderId)
    if (!active?.models.some(model => model.id === next.activeModel)) next.activeModel = firstAiModelId(active?.models)
    await window.LiteConnect.setAiSettings(next)
    const confirmed = cloneSettings(await window.LiteConnect.getAiSettings())
    const previous = persistedSettings.value
    if (scope === 'provider' && provider) {
      const saved = confirmed.providers.find(item => item.id === provider.id)!
      const index = draftSettings.value.providers.findIndex(item => item.id === provider.id)
      if (index >= 0) draftSettings.value.providers[index] = JSON.parse(JSON.stringify(saved))
      else draftSettings.value.providers.push(JSON.parse(JSON.stringify(saved)))
      if (draftSettings.value.activeProviderId === previous.activeProviderId) {
        draftSettings.value.activeProviderId = confirmed.activeProviderId
        draftSettings.value.activeModel = confirmed.activeModel
      }
      editingProviderId.value = null
      providerDraft.value = null
      newProviderId.value = null
    } else if (scope === 'history') {
      draftSettings.value.historyMaxThreads = confirmed.historyMaxThreads
      draftSettings.value.historyMaxMessages = confirmed.historyMaxMessages
      cleanupPreview.value = null
    } else {
      const pendingThreads = draftSettings.value.historyMaxThreads
      const pendingMessages = draftSettings.value.historyMaxMessages
      draftSettings.value = cloneSettings(confirmed)
      draftSettings.value.historyMaxThreads = pendingThreads
      draftSettings.value.historyMaxMessages = pendingMessages
    }
    persistedSettings.value = confirmed
    ElMessage.success(t(scope === 'provider' ? 'ai.settingsUi.providerSaved' : 'ai.settingsSaved'))
    emit('saved', confirmed)
  } catch (error: any) { ElMessage.warning(error?.message || t('ai.saveSettingsFailed')) }
  finally { saving.value = false }
}
function applyExternal(settings: AiSettings) {
  if (editingProvider.value || generalDirty.value || historyDirty.value) return
  persistedSettings.value = cloneSettings(settings)
  draftSettings.value = cloneSettings(settings)
}

defineExpose({ applyExternal })
</script>

<template>
  <div ref="settingsRoot" class="settings-box" :class="{ 'is-panel': isPanel }">
    <header class="settings-panel-header">
      <button type="button" class="ui-icon-btn ui-icon-btn-sm" :aria-label="t('common.back')" :title="t('common.back')" :disabled="saving || testingProvider" @click="goBack"><AppIcon name="chevron-left" size="sm" /></button>
      <span class="settings-panel-title">{{ editingProvider ? t(editingProviderId === newProviderId ? 'ai.addProvider' : 'ai.editProvider') : isPanel && !showingOverview ? sections.find(item => item.id === section)?.label : t('ai.settings') }}</span>
      <span class="settings-save-state" :class="{ dirty: anyChanges }" role="status">{{ t(anyChanges ? 'ai.settingsUi.unsaved' : 'ai.settingsUi.noChanges') }}</span>
    </header>
    <div class="settings-layout" :class="{ 'is-editing': editingProvider }">
      <nav v-if="!editingProvider && !isPanel" class="settings-nav" :aria-label="t('ai.settingsUi.categories')">
        <button v-for="item in sections" :key="item.id" type="button" :data-section="item.id" :class="{ active: section === item.id }" :aria-current="section === item.id ? 'page' : undefined" :disabled="saving" @click="openSection(item.id)"><AppIcon :name="item.icon" size="sm" />{{ item.label }}</button>
      </nav>
      <main :key="showingOverview ? 'overview' : editingProviderId || section" class="settings-content" :data-section="showingOverview ? 'overview' : editingProvider ? 'provider-editor' : section">
        <fieldset class="settings-fields" :disabled="saving || testingProvider">
          <section v-if="showingOverview" class="settings-overview">
            <p class="section-description">{{ t('ai.settingsUi.overviewHint') }}</p>
            <nav class="settings-categories" :aria-label="t('ai.settingsUi.categories')">
              <button v-for="item in sections" :key="item.id" type="button" class="settings-category" :data-section="item.id" @click="openSection(item.id)">
                <AppIcon :name="item.icon" size="md" class="settings-category-icon" />
                <span class="settings-category-info"><span class="settings-category-title">{{ item.label }}</span><span class="settings-category-summary">{{ sectionSummaries[item.id] }}</span></span>
                <span v-if="sectionChanges[item.id]" class="settings-category-dirty" :title="t('ai.settingsUi.unsaved')" :aria-label="t('ai.settingsUi.unsaved')"></span>
                <AppIcon name="chevron-right" size="sm" />
              </button>
            </nav>
          </section>
          <template v-else-if="!editingProvider">
            <section v-if="section === 'providers'" class="settings-section">
              <h2>{{ t('ai.settingsUi.modelsAndApi') }}</h2>
              <p class="section-description">{{ t('ai.settingsUi.modelsHint') }}</p>
      <div class="provider-list-header">
        <span class="field-label">{{ t('ai.providerList') }}</span>
        <button type="button" class="ui-btn ui-btn-xs" @click="addProvider">
          <AppIcon name="plus" size="sm" />{{ t('ai.addProvider') }}
        </button>
      </div>
      <div v-if="draftSettings.providers.length === 0" class="provider-empty">
        {{ t('ai.noProviders') }}
      </div>
      <div
        v-for="provider in draftSettings.providers"
        :key="provider.id"
        class="provider-item"
        :class="{ active: provider.id === draftSettings.activeProviderId }"
      >
        <AppIcon name="plug" size="md" class="provider-symbol" />
        <button type="button" class="provider-item-info" @click="openProvider(provider)">
          <span class="provider-item-name">{{ provider.name }}</span>
          <span class="provider-item-meta">
            {{ provider.models.length ? t('ai.modelCount', { count: provider.models.length }) : t('ai.noModels') }}
            <span v-if="provider.id === draftSettings.activeProviderId" class="provider-active-tag">{{ t('ai.settingsUi.currentProvider') }}</span>
          </span>
          <span v-if="provider.models.length" class="provider-default-model" :title="provider.models[0].displayName || provider.models[0].id">{{ t('ai.settingsUi.providerDefault', { model: provider.models[0].displayName || provider.models[0].id }) }}</span>
        </button>
        <div class="provider-item-actions">
          <button v-if="provider.id !== draftSettings.activeProviderId && provider.models.length" type="button" class="ui-btn ui-btn-xs" @click="setActiveProvider(provider)">{{ t('ai.setActiveProvider') }}</button>
          <button type="button" class="ui-icon-btn ui-icon-btn-sm" :aria-label="t('ai.editProvider')" :title="t('ai.editProvider')" @click="openProvider(provider)"><AppIcon name="edit" size="sm" /></button>
          <button type="button" class="ui-icon-btn ui-icon-btn-sm" :aria-label="t('common.delete')" :title="t('common.delete')" @click="deleteProvider(provider.id)"><AppIcon name="trash" size="sm" /></button>
        </div>
      </div>


            </section>
            <section v-else-if="section === 'conversation'" class="settings-section">
              <h2>{{ t('ai.settingsUi.conversation') }}</h2>
              <div class="settings-note"><AppIcon name="ai-chat" size="sm" /><p>{{ t('ai.settingsUi.contextHint') }}</p></div>
              <h3>{{ t('ai.historyLimits') }}</h3>
              <p class="permission-hint">{{ t('ai.settingsUi.historyScope') }}</p>
              <label for="ai-history-max-threads" class="history-limit-field"><span>{{ t('ai.historyMaxThreads') }}</span><input id="ai-history-max-threads" v-model.number="draftSettings.historyMaxThreads" class="ui-input ui-input-sm" type="number" :min="MIN_AI_HISTORY_MAX_THREADS" :max="MAX_AI_HISTORY_MAX_THREADS" step="1" @blur="draftSettings.historyMaxThreads = normalizeAiHistoryMaxThreads(draftSettings.historyMaxThreads)" /></label>
              <label for="ai-history-max-messages" class="history-limit-field"><span>{{ t('ai.historyMaxMessages') }}</span><input id="ai-history-max-messages" v-model.number="draftSettings.historyMaxMessages" class="ui-input ui-input-sm" type="number" :min="MIN_AI_HISTORY_MAX_MESSAGES" :max="MAX_AI_HISTORY_MAX_MESSAGES" step="10" @blur="draftSettings.historyMaxMessages = normalizeAiHistoryMaxMessages(draftSettings.historyMaxMessages)" /></label>
              <p class="permission-hint">{{ t('ai.historyLimitsHint') }}</p>
              <div v-if="historyDirty" class="history-cleanup-preview" role="status">
                <span v-if="previewBusy">{{ t('ai.settingsUi.previewLoading') }}</span>
                <span v-else-if="previewError" class="model-fetch-error">{{ previewError }}</span>
                <template v-else-if="cleanupPreview"><strong>{{ t('ai.settingsUi.cleanupSummary', cleanupPreview) }}</strong><p>{{ t('ai.settingsUi.cleanupDetail') }}</p></template>
                <button v-if="previewError" type="button" class="ui-btn ui-btn-xs" @click="refreshPreview().catch(() => {})"><AppIcon name="refresh" size="xs" />{{ t('ai.settingsUi.retryPreview') }}</button>
              </div>
            </section>
            <section v-else-if="section === 'permissions'" class="settings-section">
              <h2>{{ t('ai.settingsUi.execution') }}</h2>
              <h3>{{ t('ai.toolPermission') }}</h3>
              <details class="permission-hint details-with-icon"><summary><AppIcon name="chevron-right" size="xs" class="details-chevron" />{{ t('ai.permissionDetails') }}</summary><p>{{ t('ai.toolPermissionHint') }}</p></details>
              <label v-for="mode in permissionModes" :key="mode.id" class="permission-option" :class="{ active: draftSettings.toolPermission === mode.id }"><input v-model="draftSettings.toolPermission" type="radio" :value="mode.id" /><span><span class="permission-option-title">{{ mode.label }}</span><span class="permission-option-desc">{{ mode.desc }}</span></span></label>
              <h3>{{ t('ai.settingsUi.executionLimits') }}</h3>
              <label for="ai-tool-rounds" class="history-limit-field"><span>{{ t('ai.maxToolRounds') }}</span><input id="ai-tool-rounds" v-model.number="draftSettings.maxToolRounds" class="ui-input ui-input-sm" type="number" min="1" :max="MAX_AI_TOOL_ROUNDS" step="1" aria-describedby="ai-tool-rounds-hint" @blur="draftSettings.maxToolRounds = normalizeAiToolRounds(draftSettings.maxToolRounds)" /></label>
              <p id="ai-tool-rounds-hint" class="permission-hint">{{ t('ai.maxToolRoundsHint') }}</p>
            </section>
            <section v-else class="settings-section">
              <h2>{{ t('ai.settingsUi.notifications') }}</h2>
              <h3>{{ t('ai.approvalNotifications') }}</h3>
              <label class="notification-option"><input v-model="draftSettings.approvalNotifications" type="checkbox" /><span><span class="permission-option-title">{{ t('ai.approvalNotificationsEnabled') }}</span><span class="permission-option-desc">{{ t('ai.approvalNotificationsHint') }}</span></span></label>
            </section>
          </template>
          <section v-else class="settings-section provider-editor">
      <div class="provider-identity">
        <label for="ai-provider-name" class="field-label">{{ t('common.name') }}<input id="ai-provider-name" v-model="editingProvider.name" class="ui-input ui-input-sm" placeholder="OpenAI" /></label>
        <label for="ai-provider-protocol" class="field-label">{{ t('ai.providerProtocol') }}<select id="ai-provider-protocol" :value="editingProvider.protocol || 'openai'" class="ui-input ui-input-sm" @change="changeProviderProtocol">
          <option value="openai">{{ t('ai.protocolOpenai') }}</option>
          <option value="anthropic">Anthropic Messages（Claude）</option>
        </select></label>
      </div>
      <p class="permission-hint">{{ t(editingProvider.protocol === 'anthropic' ? 'ai.protocolAnthropicHint' : 'ai.protocolOpenaiHint') }}</p>

      <label for="ai-provider-url" class="field-label">Base URL</label>
      <input id="ai-provider-url" v-model="editingProvider.baseUrl" class="ui-input ui-input-sm" :placeholder="defaultAiProviderBaseUrl(editingProvider.protocol as AiProviderProtocol || 'openai')" />

      <label for="ai-provider-key" class="field-label">API Key</label>
      <div class="api-key-field"><input id="ai-provider-key" v-model="editingProvider.apiKey" class="ui-input ui-input-sm" :type="showApiKey ? 'text' : 'password'" placeholder="sk-..." autocomplete="off" />
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :aria-label="t('ai.toggleApiKey')" :aria-pressed="showApiKey" @click="showApiKey = !showApiKey"><AppIcon :name="showApiKey ? 'eye-off' : 'eye'" size="sm" /></button>
      </div>

      <div class="provider-models-header">
        <span class="field-label">{{ t('ai.modelList') }}</span>
        <div class="provider-item-actions">
          <button ref="modelFetchButton" type="button" class="ui-btn ui-btn-xs" :disabled="fetchingModels || !editingProvider.baseUrl.trim() || !editingProvider.apiKey.trim()" @click="fetchModels"><AppIcon name="refresh" size="xs" />{{ t(fetchingModels ? 'ai.fetchingModels' : 'ai.fetchModels') }}</button>
          <button type="button" class="ui-btn ui-btn-xs" @click="addModelToProvider(editingProvider)"><AppIcon name="plus" size="xs" />{{ t('ai.manualModel') }}</button>
        </div>
      </div>
      <p class="permission-hint">{{ t('ai.modelContextNote') }}</p>
      <div v-if="!editingProvider.models.length" class="provider-empty">{{ t('ai.noModels') }}</div>
      <details v-for="(model, index) in editingProvider.models" :key="index" class="model-editor" :open="!model.id">
        <summary>
          <AppIcon name="chevron-right" size="xs" class="details-chevron" />
          <span class="model-summary-name" :title="model.displayName || model.id">{{ model.displayName || model.id || t('ai.addModel') }}</span>
          <small v-if="index === 0">{{ t('ai.defaultModel') }}</small>
          <span class="model-summary-actions">
            <button type="button" class="ui-icon-btn ui-icon-btn-sm" :disabled="!model.id.trim() || index === 0" :aria-label="t('ai.setDefaultModel')" :aria-pressed="index === 0" :title="t(index === 0 ? 'ai.defaultModel' : 'ai.setDefaultModel')" @click.stop.prevent="makeDefaultModel(model)"><AppIcon :name="index === 0 ? 'star-fill' : 'star'" size="sm" /></button>
            <button type="button" class="ui-icon-btn ui-icon-btn-sm" :aria-label="t('ai.deleteModel')" :title="t('ai.deleteModel')" @click.stop.prevent="removeModelFromProvider(editingProvider, index)"><AppIcon name="trash" size="sm" /></button>
          </span>
        </summary>
        <div class="model-fields">
          <label class="field-label">{{ t('ai.modelName') }}<input v-model="model.id" class="ui-input ui-input-sm" placeholder="gpt-4o-mini" /></label>
          <label class="field-label">{{ t('ai.modelDisplayName') }}<input v-model="model.displayName" class="ui-input ui-input-sm" :placeholder="model.id" /></label>
          <label class="model-image-capability"><input v-model="model.supportsImages" type="checkbox" /><span>{{ t('ai.modelSupportsImages') }}</span></label>
          <p class="permission-hint">{{ t('ai.modelSupportsImagesHint') }}</p>
          <details class="model-advanced details-with-icon">
            <summary><AppIcon name="chevron-right" size="xs" class="details-chevron" />{{ t('ai.settingsUi.advanced') }}</summary>
            <div class="model-advanced-fields">
          <label class="field-label">{{ t('ai.contextWindow') }}<input class="ui-input ui-input-sm" type="number" min="4096" max="4000000" step="1000" :value="modelWindowValue(model)" :placeholder="modelWindowPlaceholder(model)" :title="t('ai.contextWindowHint')" @input="setModelWindowValue(model, ($event.target as HTMLInputElement).value)" /></label>
          <p class="permission-hint context-source">{{ modelWindowSourceLabel(model) }}</p>
          <label class="field-label">{{ t('ai.modelMaxOutputTokens') }}<input class="ui-input ui-input-sm" type="number" min="1" max="4000000" step="1000" :value="model.maxOutputTokens || ''" :placeholder="t('ai.contextWindowAuto')" @input="setModelBudget(model, 'maxOutputTokens', ($event.target as HTMLInputElement).value)" /></label>
          <label class="field-label">{{ t('ai.modelRetainTokens') }}<input class="ui-input ui-input-sm" type="number" min="1" max="4000000" step="1000" :value="model.compactionRetainTokens || ''" :placeholder="t('ai.contextWindowAuto')" @input="setModelBudget(model, 'compactionRetainTokens', ($event.target as HTMLInputElement).value)" /></label>
          <p class="permission-hint">{{ t('ai.modelContextBudgetHint') }}</p>
        </div>
      </details>
            </div>
          </details>


          </section>
        </fieldset>
      </main>
    </div>
    <footer v-if="!showingOverview || generalDirty" class="provider-edit-actions">
      <div class="settings-save-scope"><span>{{ t(`ai.settingsUi.${editingProvider ? 'provider' : section === 'conversation' ? 'history' : 'general'}SaveScope${isPanel ? 'Compact' : ''}`) }}</span><small v-if="historyDirty && section !== 'conversation'">{{ t('ai.settingsUi.pendingHistory') }}</small></div>
      <button v-if="editingProvider" type="button" class="ui-btn ui-btn-sm" :disabled="testingProvider || saving" @click="testProvider"><AppIcon name="circle-check" size="sm" />{{ testingProvider ? t('ai.testingProvider') : t('ai.testProvider') }}</button>
      <button type="button" class="ui-btn ui-btn-sm ui-btn-primary settings-save" :disabled="saving || testingProvider || !hasChanges || (!editingProvider && section === 'conversation' && (previewBusy || !!previewError))" @click="saveSettings"><AppIcon name="check" size="sm" />{{ saving ? t('common.saving') : editingProvider ? t('ai.settingsUi.saveProvider') : section === 'conversation' ? t('ai.settingsUi.applyHistory') : t('ai.saveSettings') }}</button>
    </footer>
    <AiModelPicker :open="showModelPicker" :provider-name="editingProvider?.name || ''" :models="fetchedModels" :added="editingProvider?.models.map(model => model.id.trim()) || []" :loading="fetchingModels" :error="fetchError" :return-focus="modelFetchButton" @close="showModelPicker = false" @retry="fetchModels" @add="addSelectedModels" />
  </div>
</template>

<style scoped src="./AiSettingsPanel.css"></style>
