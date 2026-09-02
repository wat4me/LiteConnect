<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiModel, AiProvider, AiSettings, AiToolPermissionMode } from '../../env.d.ts'
import { DEFAULT_SYSTEM_PROMPT } from '@/utils/shared/constants'
import { DEFAULT_AI_TOOL_PERMISSION } from '@shared/aiToolPolicy'
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
  raw.toolPermission = raw.toolPermission || DEFAULT_AI_TOOL_PERMISSION
  return raw
}

const permissionModes: Array<{ id: AiToolPermissionMode; label: string; desc: string }> = [
  { id: 'ask', label: t('ai.toolPermissionAsk'), desc: t('ai.toolPermissionAskDesc') },
  { id: 'ask-write', label: t('ai.toolPermissionAskWrite'), desc: t('ai.toolPermissionAskWriteDesc') },
  { id: 'readonly', label: t('ai.toolPermissionReadonly'), desc: t('ai.toolPermissionReadonlyDesc') },
  { id: 'auto', label: t('ai.toolPermissionAuto'), desc: t('ai.toolPermissionAutoDesc') },
]

const draftSettings = ref<AiSettings>(cloneSettings(props.modelValue))

const editingProviderId = ref<string | null>(null)
const testingProvider = ref(false)

const editingProvider = computed<AiProvider | null>(() => {
  if (!editingProviderId.value) return null
  return draftSettings.value.providers.find((p) => p.id === editingProviderId.value) || null
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
    toolPermission: draftSettings.value.toolPermission || DEFAULT_AI_TOOL_PERMISSION,
  }
  if (next.providers.length === 0) {
    ElMessage.warning(t('ai.needProvider'))
    return
  }
  if (!next.activeProviderId) {
    next.activeProviderId = next.providers[0].id
  }
  const activeP = next.providers.find((p) => p.id === next.activeProviderId)
  if (activeP && !activeP.baseUrl) {
    ElMessage.warning(t('ai.needBaseUrl'))
    return
  }
  if (!next.activeModel && activeP && activeP.models.length > 0) {
    next.activeModel = firstAiModelId(activeP.models)
  }

  await window.LiteConnect.setAiSettings(next)
  draftSettings.value = JSON.parse(JSON.stringify(next))
  ElMessage.success(t('ai.settingsSaved'))
  editingProviderId.value = null
  emit('saved', next)
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
      <span class="settings-panel-title">{{ t('ai.settings') }}</span>
      <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" :title="t('ai.closeSettings')" @click="emit('close')">
        <AppIcon name="close" size="sm" />
      </button>
    </div>
    <template v-if="!editingProvider">
      <div class="provider-list-header">
        <span class="field-label">{{ t('ai.providerList') }}</span>
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" @click="addProvider" :title="t('ai.addProvider')">
          <AppIcon name="plus" size="sm" />
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
        <div class="provider-item-info" @click="editingProviderId = provider.id">
          <div class="provider-item-name">{{ provider.name }}</div>
          <div class="provider-item-meta">
            {{ t('ai.modelCount', { count: provider.models.length }) }}
            <span v-if="provider.id === draftSettings.activeProviderId" class="provider-active-tag">{{ t('common.current') }}</span>
          </div>
        </div>
        <div class="provider-item-actions">
          <button
            v-if="provider.id !== draftSettings.activeProviderId && provider.models.length > 0"
            type="button"
            class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
            :title="t('ai.setActiveProvider')"
            @click="setActiveProvider(provider)"
          >
            <AppIcon name="check" size="xs" />
          </button>
          <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" :title="t('common.delete')" @click="deleteProvider(provider.id)">
            <AppIcon name="delete" size="xs" />
          </button>
        </div>
      </div>

      <div class="permission-box">
        <span class="field-label">{{ t('ai.toolPermission') }}</span>
        <p class="permission-hint">{{ t('ai.toolPermissionHint') }}</p>
        <label
          v-for="mode in permissionModes"
          :key="mode.id"
          class="permission-option"
          :class="{ active: draftSettings.toolPermission === mode.id }"
        >
          <input v-model="draftSettings.toolPermission" type="radio" :value="mode.id" />
          <span>
            <span class="permission-option-title">{{ mode.label }}</span>
            <span class="permission-option-desc">{{ mode.desc }}</span>
          </span>
        </label>
      </div>

      <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" @click="saveSettings">{{ t('ai.saveSettings') }}</button>
    </template>

    <template v-else>
      <div class="provider-edit-header">
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" @click="editingProviderId = null" :title="t('common.back')">
          <AppIcon name="chevron-left" size="sm" />
        </button>
        <span class="field-label">{{ t('ai.editProvider') }}</span>
      </div>

      <label class="field-label">{{ t('common.name') }}</label>
      <input v-model="editingProvider.name" class="ui-input ui-input-sm" placeholder="OpenAI" />

      <label class="field-label">Base URL</label>
      <input v-model="editingProvider.baseUrl" class="ui-input ui-input-sm" placeholder="https://api.openai.com/v1" />

      <label class="field-label">API Key</label>
      <input v-model="editingProvider.apiKey" class="ui-input ui-input-sm" type="password" placeholder="sk-..." />

      <div class="provider-models-header">
        <span class="field-label">{{ t('ai.modelList') }} · {{ t('ai.contextWindow') }}</span>
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" @click="addModelToProvider(editingProvider)" :title="t('ai.addModel')">
          <AppIcon name="plus" size="sm" />
        </button>
      </div>
      <div v-if="editingProvider.models.length === 0" class="provider-empty">
        {{ t('ai.noModels') }}
      </div>
      <div
        v-for="(model, index) in editingProvider.models"
        :key="index"
        class="model-input-row"
      >
        <input v-model="model.id" class="ui-input ui-input-sm model-input" placeholder="gpt-4o-mini" />
        <input
          class="ui-input ui-input-sm model-window-input"
          type="number"
          min="4096"
          max="4000000"
          step="1000"
          :value="modelWindowValue(model)"
          :placeholder="modelWindowPlaceholder(model)"
          :title="t('ai.contextWindowHint')"
          @input="setModelWindowValue(model, ($event.target as HTMLInputElement).value)"
        />
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" :title="t('ai.deleteModel')" @click="removeModelFromProvider(editingProvider, index)">
          <AppIcon name="close" size="xs" />
        </button>
      </div>

      <div class="provider-edit-actions">
        <button type="button" class="ui-btn ui-btn-sm" :disabled="testingProvider" @click="testProvider">
          {{ testingProvider ? t('ai.testingProvider') : t('ai.testProvider') }}
        </button>
        <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" @click="editingProviderId = null">{{ t('common.done') }}</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.settings-box {
  padding: 10px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  gap: 7px;
  max-height: 60vh;
  overflow-y: auto;
}

.settings-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 2px;
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
}

.provider-item.active {
  border-color: var(--accent);
}

.provider-item-info {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.provider-item-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-item-meta {
  margin-top: 2px;
  font-size: 10px;
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
  font-size: 9px;
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
  margin-top: 2px;
}


.model-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.model-input {
  flex: 1;
  min-width: 0;
}

.model-window-input {
  width: 88px;
  flex: 0 0 88px;
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
  margin-top: 4px;
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
  font-size: 10px;
  line-height: 1.4;
  color: var(--text-secondary);
}


</style>
