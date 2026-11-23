<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { Connection } from '@shared/types/connection'
import type { AiWorkspaceConversationItem } from '@shared/aiWorkspaceConversations'
import type { AiToolPermissionMode } from '@shared/aiToolPolicy'
import { aiModelId } from '@shared/aiContext'
import AppIcon from '@/components/icons/AppIcon.vue'
import AiComposerSelector from '@/components/ai/AiComposerSelector.vue'
import AiKnowledge from '@/components/ai/AiKnowledge.vue'
import { useAiChat } from '@/composables/ai/useAiChat'
import { useAiSidebarModelMenu } from '@/composables/ai/useAiSidebarModelMenu'

/**
 * A conversation that has not been sent yet. No SSH connection exists until
 * the first message is submitted; the parent owns the connect-then-send flow.
 */
const props = withDefaults(defineProps<{
  hosts: Connection[]
  status: 'idle' | 'connecting' | 'error'
  error?: string
  configured: boolean
  recent: AiWorkspaceConversationItem[]
  locked: boolean
  active?: boolean
}>(), {
  active: true,
})

const text = defineModel<string>('text', { required: true })

const emit = defineEmits<{
  (e: 'send'): void
  (e: 'cancel-connect'): void
  (e: 'open-settings'): void
  (e: 'open-history', item: AiWorkspaceConversationItem): void
  (e: 'remove-host', connectionId: string): void
}>()

const { t } = useI18n()
const { settings, refreshSettings, replaceSettings } = useAiChat()
const modelMenuId = useId()
const inputRef = ref<HTMLTextAreaElement | null>(null)
const savingComposer = ref(false)
const scope = computed(() => props.hosts.length > 1)
const primary = computed(() => props.hosts[0])
const knowledgeSessionId = computed(() => props.hosts.length ? `draft:${props.hosts.map(host => host.id).join(',')}` : '')
const connecting = computed(() => props.status === 'connecting')
const canSend = computed(() => props.configured && !!text.value.trim() && !connecting.value && !props.locked && props.hosts.length > 0)
const examples = computed(() => scope.value
  ? [t('ai.workspace.exampleCompare'), t('ai.workspace.exampleServices'), t('ai.workspace.exampleLogs')]
  : [t('ai.exampleDiskCheck'), t('ai.exampleSafeCommand'), t('ai.exampleExplainError')])

const activeProvider = computed(() =>
  (settings.value.providers || []).find(p => p.id === settings.value.activeProviderId) || settings.value.providers?.[0],
)
const displayModelName = computed(() => {
  const configuredModel = (settings.value.activeModel || '').trim()
  if (configuredModel) return configuredModel
  const first = activeProvider.value?.models?.[0]
  return first ? aiModelId(first) : ''
})
const composerModelLabel = computed(() =>
  activeProvider.value?.models.find(m => aiModelId(m) === displayModelName.value)?.displayName || displayModelName.value,
)
const permissionLabel = computed(() =>
  t(`ai.permissionShort${settings.value.toolPermission === 'auto' ? 'Auto' : settings.value.toolPermission === 'readonly' ? 'Readonly' : 'Ask'}`),
)
const permissionOptions = computed(() => ['ask', 'auto', 'readonly'].map(value => ({
  value,
  label: t(`ai.permission_${value}`),
  description: t(`ai.permissionDesc_${value}`),
})))

const {
  showModelSwitcher,
  modelSwitcherButtonRef,
  modelSwitcherDropdownRef,
  modelSwitcherStyle,
  modelSwitcherGroups,
  switchModel,
  openModelSwitcher,
  closeModelSwitcher,
  toggleModelSwitcher,
  onModelMenuKeydown,
} = useAiSidebarModelMenu({
  settings,
  loading: () => connecting.value,
  saving: () => savingComposer.value,
  active: () => props.active,
  refreshSettings,
  replaceSettings,
  applyExternal: () => {},
  closeHistory: () => {},
  t: key => t(key),
})

async function savePermission(value: string) {
  if (connecting.value || savingComposer.value) return
  savingComposer.value = true
  try {
    const next = await window.LiteConnect.getAiSettings()
    next.toolPermission = value as AiToolPermissionMode
    await window.LiteConnect.setAiSettings(next)
    replaceSettings(await window.LiteConnect.getAiSettings())
  } catch (err: any) {
    ElMessage.warning(err?.message || t('ai.saveSettingsFailed'))
  } finally {
    savingComposer.value = false
  }
}

function address(host: Connection) {
  return `${host.username}@${host.host}:${host.port || 22}`
}

function resize() {
  const el = inputRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return
  event.preventDefault()
  if (canSend.value) emit('send')
}

function useExample(example: string) {
  text.value = example
  void nextTick(() => {
    inputRef.value?.focus()
    resize()
  })
}

function focus() {
  inputRef.value?.focus({ preventScroll: true })
}

watch(text, () => { void nextTick(resize) })
onMounted(() => { resize(); focus() })
defineExpose({ focus })
</script>

<template>
  <section class="ai-draft" :aria-label="scope ? t('connections.aiDraftScopeTitle', { count: hosts.length }) : t('connections.aiDraftTitle', { name: primary?.name || '' })">
    <header class="ai-draft-header">
      <slot name="header-leading" />
      <div v-if="!scope && primary" class="ai-draft-target workspace-target-host is-static" :title="`${primary.name} (${address(primary)})`">
        <strong>{{ primary.name }}</strong>
        <span>{{ address(primary) }}</span>
      </div>
      <div v-else class="ai-draft-target">
        <strong>{{ t('connections.aiDraftScopeLabel', { count: hosts.length }) }}</strong>
      </div>
      <span class="ai-draft-state" :class="{ connecting }">
        <span class="ai-draft-dot" aria-hidden="true" />
        {{ connecting ? t('ai.workspace.connecting') : t('connections.aiDraftNotConnected') }}
      </span>
      <slot name="header-trailing" />
    </header>

    <div class="ai-draft-body">
      <div class="ai-draft-intro">
        <span class="ai-draft-mark" aria-hidden="true"><AppIcon name="ai-chat" size="xl" /></span>
        <h3>{{ scope ? t('connections.aiDraftScopeTitle', { count: hosts.length }) : t('connections.aiDraftTitle', { name: primary?.name || '' }) }}</h3>
        <p>{{ t('connections.aiDraftHint') }}</p>
        <div v-if="scope" class="ai-draft-hosts" :aria-label="t('ai.workspace.selectedServers')">
          <button
            v-for="host in hosts"
            :key="host.id"
            type="button"
            class="ai-draft-host-chip"
            :disabled="connecting || hosts.length <= 1"
            :title="t('ai.workspace.removeSelected', { name: host.name })"
            :aria-label="t('ai.workspace.removeSelected', { name: host.name })"
            @click="emit('remove-host', host.id)"
          >
            <span>{{ host.name }}</span>
            <AppIcon name="close" size="xs" />
          </button>
        </div>
        <div v-if="configured" class="ai-draft-examples">
          <button v-for="example in examples" :key="example" type="button" class="ai-draft-example" :disabled="connecting" @click="useExample(example)">
            <span>{{ example }}</span>
            <AppIcon name="chevron-right" size="xs" aria-hidden="true" />
          </button>
        </div>
        <div v-else class="ai-draft-setup" role="status">
          <span>{{ t('connections.aiDraftNoModel') }}</span>
          <button type="button" class="ui-btn ui-btn-primary ui-btn-sm" @click="emit('open-settings')">
            <AppIcon name="models" size="sm" />
            {{ t('ai.manageModels') }}
          </button>
        </div>
        <section v-if="recent.length" class="ai-draft-recent">
          <h4>{{ t('connections.aiDraftResume') }}</h4>
          <button
            v-for="item in recent"
            :key="`${item.connectionId}:${item.threadId}`"
            type="button"
            class="ai-draft-recent-item"
            :disabled="connecting || locked"
            :title="item.title"
            @click="emit('open-history', item)"
          >
            <AppIcon name="history" size="sm" />
            <span class="ai-draft-recent-title">{{ item.title || item.hostLabel }}</span>
            <span class="ai-draft-recent-time">{{ new Date(item.updatedAt).toLocaleDateString() }}</span>
          </button>
        </section>
      </div>
    </div>

    <div class="ai-draft-composer-area">
      <div v-if="connecting || status === 'error'" class="ai-draft-status" :class="{ error: status === 'error' }" :role="status === 'error' ? 'alert' : 'status'">
        <span class="ai-draft-status-text">
          {{ connecting ? t('connections.aiDraftConnecting', { name: scope ? t('connections.aiDraftScopeLabel', { count: hosts.length }) : primary?.name }) : (error || t('ai.workspace.connectFailedHint')) }}
        </span>
        <button v-if="connecting" type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="emit('cancel-connect')">{{ t('common.cancel') }}</button>
      </div>
      <form class="ai-draft-composer" @submit.prevent="canSend && emit('send')">
        <div v-if="knowledgeSessionId" class="ai-draft-context-strip">
          <AiKnowledge :session-id="knowledgeSessionId" :active="active" :busy="connecting" />
        </div>
        <textarea
          ref="inputRef"
          v-model="text"
          class="ai-draft-input"
          rows="2"
          :readonly="connecting"
          :placeholder="t('ai.inputPlaceholder')"
          :aria-label="t('ai.inputPlaceholder')"
          :title="t('ai.inputHint')"
          @keydown="onKeydown"
        />
        <div class="ai-draft-actions">
          <div class="draft-model-wrap">
            <button
              v-if="modelSwitcherGroups.length > 0"
              ref="modelSwitcherButtonRef"
              type="button"
              class="ui-btn ui-btn-ghost ui-btn-sm ai-model-switcher"
              :disabled="connecting || savingComposer"
              :aria-expanded="showModelSwitcher"
              aria-haspopup="menu"
              :class="{ active: showModelSwitcher }"
              :aria-controls="showModelSwitcher ? modelMenuId : undefined"
              :title="activeProvider ? `${activeProvider.name} · ${displayModelName}` : displayModelName"
              @click="toggleModelSwitcher"
              @keydown.down.prevent="openModelSwitcher('first')"
              @keydown.up.prevent="openModelSwitcher('last')"
              @keydown.esc.stop.prevent="closeModelSwitcher(true)"
            >
              <span class="ai-model-switcher-name">{{ composerModelLabel || t('ai.manageModels') }}</span>
              <AppIcon name="chevron-down" size="xs" />
            </button>
            <button
              v-else
              type="button"
              class="ui-btn ui-btn-ghost ui-btn-sm ai-model-switcher"
              :disabled="connecting"
              @click="emit('open-settings')"
            >
              <AppIcon name="models" size="xs" />
              <span class="ai-model-switcher-name">{{ t('ai.manageModels') }}</span>
            </button>
          </div>
          <div class="draft-permission-selector">
            <AiComposerSelector
              icon="shield"
              :title="t('ai.permissionTitle')"
              :label="permissionLabel"
              :value="settings.toolPermission || 'ask'"
              :options="permissionOptions"
              :active="active"
              :disabled="connecting || savingComposer"
              @change="savePermission($event)"
            />
          </div>
          <button type="submit" class="ai-draft-send" :disabled="!canSend" :aria-label="status === 'error' ? t('connections.aiDraftRetry') : t('ai.sendMessage')" :title="status === 'error' ? t('connections.aiDraftRetry') : t('ai.sendMessage')">
            <AppIcon :name="status === 'error' ? 'refresh' : 'send'" size="sm" />
          </button>
        </div>
      </form>
    </div>

    <Teleport to="body">
      <div
        v-if="showModelSwitcher && modelSwitcherGroups.length > 0"
        ref="modelSwitcherDropdownRef"
        class="model-switcher-dropdown"
        :id="modelMenuId"
        role="menu"
        :aria-label="t('ai.manageModels')"
        :style="modelSwitcherStyle"
        @keydown="onModelMenuKeydown"
      >
        <div
          v-for="group in modelSwitcherGroups"
          :key="group.providerId"
          class="model-switcher-group"
        >
          <div class="model-switcher-group-title">{{ group.providerName }}</div>
          <button
            v-for="item in group.models"
            :key="item.providerId + item.model"
            type="button"
            class="model-switcher-item"
            role="menuitemradio"
            :aria-checked="item.active"
            :class="{ active: item.active }"
            @click="switchModel(item.providerId, item.model)"
          >
            <span class="model-option-label">{{ item.label }}<small v-if="item.label !== item.model">{{ item.model }}</small></span>
            <AppIcon v-if="item.active" name="check" size="sm" />
          </button>
        </div>
      </div>
      <div
        v-if="showModelSwitcher"
        class="model-switcher-overlay"
        @click="closeModelSwitcher(true)"
      ></div>
    </Teleport>
  </section>
</template>

<style scoped src="../ai/aiWorkspaceShared.css"></style>
<style scoped>
.ai-draft {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  background: var(--bg-primary);
}

.ai-draft-header {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 44px;
  padding: 6px 10px 6px 12px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
  font-size: var(--font-caption);
}

.ai-draft-target { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; }
.ai-draft-target > strong { font-size: var(--font-ui-sm); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ai-draft-state { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; color: var(--text-secondary); white-space: nowrap; margin-right: auto; }
.ai-draft-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--text-secondary); opacity: 0.55; }
.ai-draft-state.connecting { color: var(--accent); }
.ai-draft-state.connecting .ai-draft-dot { background: var(--accent); opacity: 1; animation: ai-draft-pulse 1.2s ease-in-out infinite; }

.ai-draft-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: clamp(24px, 8vh, 72px) 20px 180px;
}

.ai-draft-intro {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  width: min(100%, 620px);
  margin: 0 auto;
  text-align: center;
}

.ai-draft-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 14px;
  background: var(--accent-bg);
  color: var(--accent);
}

.ai-draft-intro h3 { margin: 4px 0 0; font-size: var(--font-section); color: var(--text-primary); overflow-wrap: anywhere; }
.ai-draft-intro > p { margin: 0; max-width: 460px; color: var(--text-secondary); font-size: var(--font-ui-sm); line-height: 1.6; }

.ai-draft-hosts { display: flex; flex-wrap: wrap; justify-content: center; gap: 6px; }
.ai-draft-host-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 200px;
  padding: 3px 6px 3px 9px;
  border: 1px solid var(--workspace-line);
  border-radius: 999px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-caption);
  cursor: pointer;
}
.ai-draft-host-chip span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-draft-host-chip:hover:not(:disabled) { border-color: var(--border-color); background: var(--hover-bg); }
.ai-draft-host-chip:disabled { cursor: default; }
.ai-draft-host-chip:disabled :deep(.app-icon) { display: none; }

.ai-draft-examples { display: flex; flex-direction: column; gap: 6px; width: min(100%, 420px); margin-top: 10px; }
.ai-draft-example {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border: 1px solid var(--workspace-line);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-ui-sm);
  text-align: left;
  cursor: pointer;
}
.ai-draft-example:hover:not(:disabled) { border-color: var(--border-color); background: var(--hover-bg); }
.ai-draft-example :deep(.app-icon) { color: var(--text-secondary); flex-shrink: 0; }

.ai-draft-setup { display: flex; flex-direction: column; align-items: center; gap: 10px; margin-top: 10px; color: var(--text-secondary); font-size: var(--font-ui-sm); }

.ai-draft-recent { width: min(100%, 420px); margin-top: 18px; text-align: left; }
.ai-draft-recent h4 { margin: 0 0 6px 2px; color: var(--text-secondary); font-size: var(--font-caption); font-weight: 600; }
.ai-draft-recent-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-ui-sm);
  text-align: left;
  cursor: pointer;
}
.ai-draft-recent-item:hover:not(:disabled) { background: var(--tab-hover-surface); }
.ai-draft-recent-item :deep(.app-icon) { color: var(--text-secondary); flex-shrink: 0; }
.ai-draft-recent-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-draft-recent-time { flex-shrink: 0; color: var(--text-secondary); font-size: var(--font-caption); }

.ai-draft-composer-area {
  position: absolute;
  z-index: 4;
  left: max(18px, calc((100% - 1060px) / 2));
  right: max(18px, calc((100% - 1060px) / 2));
  bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ai-draft-status {
  display: flex;
  align-items: center;
  gap: 8px;
  align-self: center;
  max-width: 100%;
  padding: 5px 6px 5px 12px;
  border: 1px solid var(--workspace-line);
  border-radius: 999px;
  background: var(--bg-primary);
  box-shadow: var(--shadow-menu);
  color: var(--text-secondary);
  font-size: var(--font-caption);
}
.ai-draft-status.error { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--border-color)); border-radius: var(--radius-md); }
.ai-draft-status-text { min-width: 0; overflow-wrap: anywhere; }

.ai-draft-composer {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px 12px 8px;
  border: 1px solid color-mix(in srgb, var(--text-primary) 12%, var(--border-color));
  border-radius: 16px;
  background: var(--mica-composer-bg, var(--bg-primary));
  box-shadow: 0 4px 18px color-mix(in srgb, var(--overlay-bg) 10%, transparent);
  transition: border-color 0.15s, box-shadow 0.15s;
}
.ai-draft-composer:focus-within { border-color: color-mix(in srgb, var(--accent) 55%, var(--border-color)); box-shadow: 0 0 0 3px var(--accent-bg); }
.ai-draft-context-strip { display: flex; align-items: center; gap: 6px; min-width: 0; height: 26px; }

.ai-draft-input {
  resize: none;
  border: 0;
  outline: none;
  padding: 2px;
  background: transparent;
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-ai-content);
  line-height: 1.6;
  max-height: 200px;
  overflow-y: auto;
}
.ai-draft-input::placeholder { color: var(--text-secondary); }
.ai-draft-input[readonly] { color: var(--text-secondary); }

.ai-draft-actions { display: flex; align-items: center; gap: 6px; min-width: 0; }
.draft-model-wrap { flex: 0 1 auto; min-width: 0; max-width: 240px; height: var(--control-h-sm); display: flex; align-items: center; }
.ai-model-switcher { gap: 4px; max-width: 100%; min-width: 0; padding: 0 6px; }
.ai-model-switcher.active { background: var(--tab-selected-surface); color: var(--text-primary); }
.ai-model-switcher-name { min-width: 0; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-model-switcher :deep(.app-icon) { flex-shrink: 0; }
.draft-permission-selector { display: flex; height: var(--control-h-sm); align-items: center; margin-left: auto; flex-shrink: 0; }
.model-switcher-overlay { position: fixed; inset: 0; z-index: var(--z-menu-backdrop); }
.model-switcher-dropdown {
  position: fixed;
  z-index: var(--z-menu);
  min-width: 200px;
  max-width: 280px;
  padding: 6px;
  background: var(--bg-primary);
  border: 1px solid var(--workspace-line, var(--border-color));
  border-radius: var(--workspace-panel-radius, var(--radius-md));
  box-shadow: var(--shadow-menu);
  max-height: min(280px, calc(100vh - 16px));
  overflow-y: auto;
}
.model-switcher-group + .model-switcher-group { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--border-color); }
.model-switcher-group-title { padding: 4px 6px; font-size: var(--font-caption); font-weight: 700; color: var(--text-secondary); }
.model-switcher-item {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: 6px 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-primary);
  font-size: var(--font-ui-sm);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  cursor: pointer;
  text-align: left;
}
.model-switcher-item:hover, .model-switcher-item:focus-visible { background: var(--hover-bg); }
.model-switcher-item:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.model-switcher-item.active { color: var(--text-primary); background: var(--tab-selected-surface); }
.model-option-label { overflow-wrap: anywhere; min-width: 0; }
.model-option-label small { display: block; color: var(--text-secondary); font-size: var(--font-caption); margin-top: 3px; }
.ai-draft-send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: calc(38px * var(--ui-scale, 1));
  height: calc(38px * var(--ui-scale, 1));
  border: 0;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  cursor: pointer;
}
.ai-draft-send:hover:not(:disabled) { background: var(--accent-hover); }
.ai-draft-send:disabled { background: var(--bg-tertiary); color: var(--text-secondary); cursor: not-allowed; }

@keyframes ai-draft-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
</style>
