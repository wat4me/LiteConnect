<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiModel, AiProvider, AiSettings, AiToolPermissionMode } from '../../env.d.ts'
import { DEFAULT_SYSTEM_PROMPT } from '@/utils/shared/constants'
import { DEFAULT_AI_TOOL_PERMISSION, sanitizeAiToolPermission } from '@shared/aiToolPolicy'
import { firstAiModelId, inferContextWindowTokens, parseAiModels } from '@shared/aiContext'
import AppIcon from '../icons/AppIcon.vue'

const { t } = useI18n()

const props = defineProps<{
  modelValue?: AiSettings
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
    models: parseAiModels(p.models),
  }))
  raw.toolPermission = sanitizeAiToolPermission(raw.toolPermission)
  return raw
}

const permissionModes: Array<{ id: AiToolPermissionMode; label: string; desc: string }> = [
  { id: 'ask', label: t('ai.toolPermissionAsk'), desc: t('ai.toolPermissionAskDesc') },
  { id: 'readonly', label: t('ai.toolPermissionReadonly'), desc: t('ai.toolPermissionReadonlyDesc') },
  { id: 'auto', label: t('ai.toolPermissionAuto'), desc: t('ai.toolPermissionAutoDesc') },
]

const draftSettings = ref<AiSettings>(cloneSettings(props.modelValue))
const editingProviderId = ref<string | null>(null)
const testingProvider = ref(false)
const saving = ref(false)
const showApiKey = ref(false)
const fetchingModels = ref(false)
const fetchedModels = ref<string[] | null>(null)
const modelQuery = ref('')
const selectedModels = ref<string[]>([])
const fetchError = ref('')
const filteredModels = computed(() => (fetchedModels.value || []).filter(id => id.toLowerCase().includes(modelQuery.value.toLowerCase())))
function isModelAdded(id: string) { return editingProvider.value?.models.some(m => m.id.trim() === id) }
watch(editingProviderId, () => { fetchedModels.value = null; fetchError.value = ''; selectedModels.value = []; modelQuery.value = '' })
async function fetchModels() {
  const provider = editingProvider.value
  if (!provider || fetchingModels.value) return
  fetchingModels.value = true
  fetchError.value = ''
  fetchedModels.value = null
  selectedModels.value = []
  const baseUrl = provider.baseUrl
  const apiKey = provider.apiKey
  try {
    const models = await window.LiteConnect.listAiModels({ baseUrl, apiKey })
    if (editingProvider.value === provider && provider.baseUrl === baseUrl && provider.apiKey === apiKey) fetchedModels.value = models
  } catch (error: any) {
    if (editingProvider.value === provider) fetchError.value = error?.message || t('ai.fetchModelsFailed')
  } finally { fetchingModels.value = false }
}
function addSelectedModels() {
  const provider = editingProvider.value
  if (!provider) return
  for (const id of selectedModels.value) if (!isModelAdded(id)) provider.models.push({ id })
  selectedModels.value = []
  fetchedModels.value = null
}
function makeDefaultModel(model: AiModel) {
  const provider = editingProvider.value
  if (!provider || !model.id.trim()) return
  provider.models = [model, ...provider.models.filter(m => m !== model)]
  if (draftSettings.value.activeProviderId === provider.id) draftSettings.value.activeModel = model.id.trim()
}
const newProviderId = ref<string | null>(null)

watch(editingProviderId, () => { showApiKey.value = false })

function goBack() {
  if (saving.value || testingProvider.value) return
  if (editingProviderId.value) editingProviderId.value = null
  else emit('close')
}

watch(
  () => props.modelValue,
  (value) => {
    if (!value || editingProviderId.value) return
    draftSettings.value = cloneSettings(value)
  },
)

const editingProvider = computed<AiProvider | null>(() => {
  if (!editingProviderId.value) return null
  return draftSettings.value.providers.find((p) => p.id === editingProviderId.value) || null
})

watch(() => [editingProvider.value?.baseUrl, editingProvider.value?.apiKey], () => {
  fetchedModels.value = null
  selectedModels.value = []
  fetchError.value = ''
})

function generateProviderId(): string {
  return `prov-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function addProvider() {
  const newProvider: AiProvider = {
    id: generateProviderId(),
    name: t('ai.newProvider'),
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    models: [],
  }
  draftSettings.value.providers.push(newProvider)
  editingProviderId.value = newProvider.id
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
  return String(inferContextWindowTokens(model.id))
}

function setModelWindowValue(model: AiModel, raw: string) {
  const n = Number(raw)
  if (!raw.trim() || !Number.isFinite(n) || n <= 0) {
    model.contextWindowTokens = undefined
    return
  }
  model.contextWindowTokens = Math.round(n)
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
  if (saving.value) return
  const next: AiSettings = {
    providers: draftSettings.value.providers.map((p) => ({
      id: p.id,
      name: p.name.trim() || t('ai.unnamedProvider'),
      baseUrl: p.baseUrl.trim(),
      apiKey: p.apiKey,
      models: parseAiModels(p.models),
    })),
    activeProviderId: draftSettings.value.activeProviderId,
    activeModel: draftSettings.value.activeModel.trim(),
    systemPrompt: draftSettings.value.systemPrompt,
    temperature: 0.7,
    toolPermission: sanitizeAiToolPermission(draftSettings.value.toolPermission),
  }
  if (next.providers.length === 0) {
    ElMessage.warning(t('ai.needProvider'))
    return
  }
  if (next.providers.some((p) => p.models.length === 0)) {
    ElMessage.warning(t('ai.needModel'))
    return
  }
  if (!next.activeProviderId || !next.providers.some((p) => p.id === next.activeProviderId)) {
    next.activeProviderId = next.providers[0].id
  }
  const activeP = next.providers.find((p) => p.id === next.activeProviderId)
  if (activeP && !activeP.baseUrl) {
    ElMessage.warning(t('ai.needBaseUrl'))
    return
  }
  if (activeP && !activeP.models.some(m => m.id === next.activeModel)) {
    next.activeModel = firstAiModelId(activeP.models)
  }

  saving.value = true
  try {
    await window.LiteConnect.setAiSettings(next)
    const confirmed = await window.LiteConnect.getAiSettings().catch(() => next)
    draftSettings.value = cloneSettings(confirmed)
    ElMessage.success(t('ai.settingsSaved'))
    editingProviderId.value = null
    newProviderId.value = null
    emit('saved', confirmed)
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.saveSettingsFailed'))
  } finally {
    saving.value = false
  }
}

/** Sync draft when parent reloads settings (e.g. after model switch) */
function applyExternal(settings: AiSettings) {
  draftSettings.value = cloneSettings(settings)
}

defineExpose({ applyExternal })
</script>

<template>
  <div class="settings-box">
    <div class="settings-panel-header">
      <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :aria-label="t('common.back')" :disabled="saving || testingProvider" @click="goBack"><AppIcon name="chevron-left" size="sm" /></button>
      <span class="settings-panel-title">{{ editingProvider ? t(editingProviderId === newProviderId ? 'ai.addProvider' : 'ai.editProvider') : t('ai.settings') }}</span>
    </div>
    <div class="settings-content">
    <template v-if="!editingProvider">
      <div class="provider-list-header">
        <span class="field-label">{{ t('ai.providerList') }}</span>
        <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="addProvider">
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
        <AppIcon name="server" size="md" class="provider-symbol" />
        <button type="button" class="provider-item-info" @click="editingProviderId = provider.id">
          <span class="provider-item-name">{{ provider.name }}</span>
          <span class="provider-item-meta">
            {{ provider.models.length ? t('ai.modelCount', { count: provider.models.length }) : t('ai.noModels') }}
            <span v-if="provider.id === draftSettings.activeProviderId" class="provider-active-tag">{{ t('common.current') }}</span>
          </span>
        </button>
        <div class="provider-item-actions">
          <button v-if="provider.id !== draftSettings.activeProviderId && provider.models.length" type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="setActiveProvider(provider)">{{ t('ai.setActiveProvider') }}</button>
          <details class="provider-more">
            <summary :aria-label="t('ai.moreActions')" :title="t('ai.moreActions')">⋯</summary>
            <div class="provider-more-menu">
              <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="editingProviderId = provider.id">{{ t('ai.editProvider') }}</button>
              <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="deleteProvider(provider.id)">{{ t('common.delete') }}</button>
            </div>
          </details>
        </div>
      </div>

      <div class="permission-box">
        <span class="field-label">{{ t('ai.toolPermission') }}</span>
        <details class="permission-hint"><summary>{{ t('ai.permissionDetails') }}</summary><p>{{ t('ai.toolPermissionHint') }}</p></details>
        <label
          v-for="mode in permissionModes"
          :key="mode.id"
          class="permission-option"
          :class="{ active: draftSettings.toolPermission === mode.id }"
        >
          <input v-model="draftSettings.toolPermission" type="radio" :value="mode.id" />
          <span>
            <span class="permission-option-title">{{ mode.label }}</span>
            <span v-if="draftSettings.toolPermission === mode.id" class="permission-option-desc">{{ mode.desc }}</span>
          </span>
        </label>
      </div>


    </template>

    <template v-else>
      <label for="ai-provider-name" class="field-label">{{ t('common.name') }}</label>
      <input id="ai-provider-name" v-model="editingProvider.name" class="ui-input ui-input-sm" placeholder="OpenAI" />

      <label for="ai-provider-url" class="field-label">Base URL</label>
      <input id="ai-provider-url" v-model="editingProvider.baseUrl" class="ui-input ui-input-sm" placeholder="https://api.openai.com/v1" />

      <label for="ai-provider-key" class="field-label">API Key</label>
      <div class="api-key-field"><input id="ai-provider-key" v-model="editingProvider.apiKey" class="ui-input ui-input-sm" :type="showApiKey ? 'text' : 'password'" placeholder="sk-..." autocomplete="off" />
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :aria-label="t('ai.toggleApiKey')" :aria-pressed="showApiKey" @click="showApiKey = !showApiKey"><AppIcon :name="showApiKey ? 'eye-off' : 'eye'" size="sm" /></button>
      </div>

      <div class="provider-models-header">
        <span class="field-label">{{ t('ai.modelList') }}</span>
        <div class="provider-item-actions">
          <button type="button" class="ui-btn ui-btn-xs" :disabled="fetchingModels || !editingProvider.baseUrl.trim() || !editingProvider.apiKey.trim()" @click="fetchModels">{{ t(fetchingModels ? 'ai.fetchingModels' : 'ai.fetchModels') }}</button>
          <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="addModelToProvider(editingProvider)">{{ t('ai.manualModel') }}</button>
        </div>
      </div>
      <p v-if="fetchError" class="model-fetch-error" role="alert">{{ fetchError }}</p>
      <div v-if="fetchedModels !== null" class="model-picker">
        <input v-model="modelQuery" class="ui-input ui-input-sm" :placeholder="t('ai.searchModels')" :aria-label="t('ai.searchModels')" />
        <div class="model-picker-list">
          <label v-for="id in filteredModels" :key="id" class="model-choice">
            <input v-model="selectedModels" type="checkbox" :value="id" :disabled="isModelAdded(id)" />
            <span>{{ id }}</span><small v-if="isModelAdded(id)">{{ t('ai.modelAdded') }}</small>
          </label>
          <p v-if="!filteredModels.length" class="provider-empty">{{ t('ai.noMatchingModels') }}</p>
        </div>
        <div class="provider-item-actions">
          <button type="button" class="ui-btn ui-btn-xs ui-btn-primary" :disabled="!selectedModels.length" @click="addSelectedModels">{{ t('ai.addSelectedModels', { count: selectedModels.length }) }}</button>
          <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="fetchedModels = null">{{ t('common.cancel') }}</button>
        </div>
      </div>
      <p class="permission-hint">{{ t('ai.modelContextNote') }}</p>
      <div v-if="!editingProvider.models.length" class="provider-empty">{{ t('ai.noModels') }}</div>
      <details v-for="(model, index) in editingProvider.models" :key="index" class="model-editor" :open="!model.id">
        <summary><span>{{ model.displayName || model.id || t('ai.addModel') }}</span><small v-if="index === 0">{{ t('ai.defaultModel') }}</small></summary>
        <div class="model-fields">
          <label class="field-label">{{ t('ai.modelName') }}<input v-model="model.id" class="ui-input ui-input-sm" placeholder="gpt-4o-mini" /></label>
          <label class="field-label">{{ t('ai.modelDisplayName') }}<input v-model="model.displayName" class="ui-input ui-input-sm" :placeholder="model.id" /></label>
          <label class="field-label">{{ t('ai.contextWindow') }}<input class="ui-input ui-input-sm" type="number" min="4096" max="4000000" step="1000" :value="modelWindowValue(model)" :placeholder="modelWindowPlaceholder(model)" :title="t('ai.contextWindowHint')" @input="setModelWindowValue(model, ($event.target as HTMLInputElement).value)" /></label>
          <div class="provider-item-actions">
            <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" :disabled="!model.id.trim() || index === 0" @click="makeDefaultModel(model)">{{ t('ai.setDefaultModel') }}</button>
            <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="removeModelFromProvider(editingProvider, index)">{{ t('ai.deleteModel') }}</button>
          </div>
        </div>
      </details>

    </template>
    </div>
    <div class="provider-edit-actions">
      <button v-if="editingProvider" type="button" class="ui-btn ui-btn-sm" :disabled="testingProvider || saving" @click="testProvider"><AppIcon name="link" size="sm" />{{ testingProvider ? t('ai.testingProvider') : t('ai.testProvider') }}</button>
      <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" :disabled="saving || testingProvider" @click="saveSettings"><AppIcon name="check" size="sm" />{{ t('ai.saveSettings') }}</button>
    </div>
  </div>
</template>

<style scoped>
.settings-box {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-primary);
  overflow: hidden;
}
.settings-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
}
.settings-content > * {
  flex-shrink: 0;
}
.settings-content > .field-label:not(:first-child) {
  margin-top: 8px;
}
.api-key-field {
  display: flex;
  align-items: center;
  gap: 6px;
}
.api-key-field input {
  flex: 1;
  min-width: 0;
}
.provider-symbol {
  color: var(--text-secondary);
  flex-shrink: 0;
}
.model-column-labels {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 88px 24px;
  gap: 6px;
  font-size: 11px;
  color: var(--text-secondary);
}
.settings-panel-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 48px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.settings-panel-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}



.provider-list-header,
.provider-models-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.provider-models-header {
  margin-top: 16px;
}

.provider-empty {
  padding: 10px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: center;
}

.provider-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  transition: border-color 0.15s;
  flex-shrink: 0;
}

.provider-item.active {
  border-color: var(--accent);
}

.provider-item-info {
  padding: 0;
  border: 0;
  background: transparent;
  text-align: left;
  font: inherit;
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.provider-item-name {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-item-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary);
  display: flex;
  align-items: center;
  gap: 6px;
}

.provider-active-tag {
  padding: 1px 5px;
  border-radius: 3px;
  background: var(--accent-bg);
  color: var(--accent);
  font-size: 11px;
  font-weight: 700;
}

.provider-item-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.provider-edit-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.provider-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
  background: var(--bg-primary);
}


.model-input-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 88px 24px;
  align-items: center;
  gap: 6px;
}

.model-input {
  flex: 1;
  min-width: 0;
}

.model-window-input {
  width: 100%;
  min-width: 0;
  padding-left: 6px;
  padding-right: 6px;
}

.field-label {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 600;
}

.permission-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid var(--border-color);
}

.permission-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary);
  font-weight: 400;
}

.permission-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-secondary);
  cursor: pointer;
}

.permission-option.active {
  border-color: var(--accent);
}

.permission-option input {
  margin-top: 2px;
}

.permission-option-title {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.permission-option-desc {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary);
}


.model-picker, .model-editor { border: 1px solid var(--border-color); border-radius: 8px; padding: 10px; }
.model-picker-list { max-height: 220px; overflow-y: auto; margin: 8px 0; }
.model-choice { display: flex; gap: 8px; align-items: center; padding: 6px 0; font-size: 12px; color: var(--text-primary); }
.model-choice span { overflow-wrap: anywhere; flex: 1; }
.model-choice small, .model-editor small { color: var(--text-secondary); font-size: 11px; }
.model-editor summary { cursor: pointer; font-size: 12px; color: var(--text-primary); overflow-wrap: anywhere; }
.model-editor summary small { margin-left: 8px; }
.model-fields { display: grid; gap: 10px; padding-top: 12px; }
.model-fields label { display: grid; gap: 5px; }
.model-fetch-error { font-size: 12px; color: var(--danger); overflow-wrap: anywhere; }
.provider-more { position: relative; }
.provider-more summary { list-style: none; cursor: pointer; padding: 4px 8px; color: var(--text-secondary); }
.provider-more-menu { position: absolute; right: 0; top: 100%; z-index: 5; display: grid; padding: 6px; white-space: nowrap; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: 0 4px 16px #0002; }
</style>
