<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiProvider, AiSettings } from '../env.d.ts'
import { DEFAULT_SYSTEM_PROMPT } from '../utils/constants'
import AppIcon from './icons/AppIcon.vue'

const { t } = useI18n()

const props = defineProps<{
  modelValue?: AiSettings
}>()

const emit = defineEmits<{
  (e: 'saved', settings: AiSettings): void
  (e: 'close'): void
}>()

const draftSettings = ref<AiSettings>(
  props.modelValue
    ? JSON.parse(JSON.stringify(props.modelValue))
    : {
        providers: [],
        activeProviderId: null,
        activeModel: '',
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        temperature: 0.7,
      },
)

const editingProviderId = ref<string | null>(null)

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
    draftSettings.value.activeModel = firstP?.models[0] || ''
  }
  if (editingProviderId.value === id) {
    editingProviderId.value = null
  }
}

function addModelToProvider(provider: AiProvider) {
  provider.models.push('')
}

function removeModelFromProvider(provider: AiProvider, index: number) {
  provider.models.splice(index, 1)
}

async function saveSettings() {
  const next: AiSettings = {
    providers: draftSettings.value.providers.map((p) => ({
      id: p.id,
      name: p.name.trim() || t('ai.unnamedProvider'),
      baseUrl: p.baseUrl.trim(),
      apiKey: p.apiKey,
      models: p.models.filter((m) => m.trim()).map((m) => m.trim()),
    })),
    activeProviderId: draftSettings.value.activeProviderId,
    activeModel: draftSettings.value.activeModel.trim(),
    systemPrompt: draftSettings.value.systemPrompt,
    temperature: 0.7,
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
    next.activeModel = activeP.models[0]
  }

  await window.LiteConnect.setAiSettings(next)
  draftSettings.value = JSON.parse(JSON.stringify(next))
  ElMessage.success(t('ai.settingsSaved'))
  editingProviderId.value = null
  emit('saved', next)
}

/** Sync draft when parent reloads settings (e.g. after model switch) */
function applyExternal(settings: AiSettings) {
  draftSettings.value = JSON.parse(JSON.stringify(settings))
}

defineExpose({ applyExternal })
</script>

<template>
  <div class="settings-box">
    <div class="settings-panel-header">
      <span class="settings-panel-title">{{ t('ai.settings') }}</span>
      <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close" :title="t('ai.closeSettings')" @click="emit('close')">
        <AppIcon name="close" :size="14" />
      </button>
    </div>
    <template v-if="!editingProvider">
      <div class="provider-list-header">
        <span class="field-label">{{ t('ai.providerList') }}</span>
        <button class="add-provider-btn" @click="addProvider" :title="t('ai.addProvider')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
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
            class="provider-set-active-btn"
            :title="t('ai.setActiveProvider')"
            @click="draftSettings.activeProviderId = provider.id; draftSettings.activeModel = provider.models[0] || ''"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </button>
          <button class="provider-delete-btn" :title="t('common.delete')" @click="deleteProvider(provider.id)">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="settings-divider"></div>

      <label class="field-label">{{ t('ai.systemPrompt') }}</label>
      <textarea v-model="draftSettings.systemPrompt" class="ui-textarea ui-input-sm" rows="3" />

      <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" @click="saveSettings">{{ t('ai.saveSettings') }}</button>
    </template>

    <template v-else>
      <div class="provider-edit-header">
        <button class="back-btn" @click="editingProviderId = null" :title="t('common.back')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
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
        <span class="field-label">{{ t('ai.modelList') }}</span>
        <button class="add-provider-btn" @click="addModelToProvider(editingProvider)" :title="t('ai.addModel')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
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
        <input v-model="editingProvider.models[index]" class="ui-input ui-input-sm model-input" placeholder="gpt-4o-mini" />
        <button class="provider-delete-btn" :title="t('ai.deleteModel')" @click="removeModelFromProvider(editingProvider, index)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" @click="editingProviderId = null">{{ t('common.done') }}</button>
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

.add-provider-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px dashed var(--border-color);
  border-radius: 4px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.add-provider-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
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

.provider-set-active-btn,
.provider-delete-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s;
}

.provider-set-active-btn:hover {
  background: var(--accent-bg);
  color: var(--accent);
}

.provider-delete-btn:hover {
  background: rgba(248, 81, 73, 0.15);
  color: var(--danger);
}

.settings-divider {
  height: 1px;
  background: var(--border-color);
  margin: 4px 0;
}

.provider-edit-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.back-btn {
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--text-secondary);
  cursor: pointer;
}

.back-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.model-input-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.model-input {
  flex: 1;
}

.field-label {
  font-size: 11px;
  color: var(--text-secondary);
  font-weight: 600;
}
</style>
