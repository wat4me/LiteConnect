<script setup lang="ts">
import { nextTick, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { AI_WORKSPACE_MAX_HOSTS } from '@shared/aiWorkspace'
import type { Connection } from '@shared/types/connection'
import AppIcon from '@/components/icons/AppIcon.vue'

interface PickerGroup {
  id: string
  name: string
  hosts: Connection[]
}

const props = defineProps<{
  mode: 'switch' | 'new' | 'create'
  pickerHosts: Connection[]
  pickerGroups: PickerGroup[]
  pickerSelection: string[]
  selectedHosts: Connection[]
  selectedId: string
  sessions: Record<string, string>
  connectingId: string
  closing: boolean
  scopeBusy: boolean
  pickerError: string
  isGroupCollapsed: (id: string) => boolean
  trapFocus: (event: KeyboardEvent) => void
}>()

const query = defineModel<string>('query', { required: true })

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'toggle-group', id: string): void
  (e: 'pick', connection: Connection): void
  (e: 'cancel-connect'): void
  (e: 'clear-selection'): void
  (e: 'remove-selection', id: string): void
  (e: 'start-scope', connectionIds: string[]): void
}>()

const { t } = useI18n()
const pickerEl = useTemplateRef<HTMLElement>('pickerRef')
const searchEl = useTemplateRef<HTMLInputElement>('searchRef')
defineExpose({ pickerEl })

function removeSelection(id: string, event: MouseEvent) {
  const chip = event.currentTarget as HTMLButtonElement
  emit('remove-selection', id)
  if (document.activeElement === chip) void nextTick(() => {
    if (!chip.isConnected) searchEl.value?.focus({ preventScroll: true })
  })
}

function titleKey() {
  if (props.mode === 'create') return 'ai.workspace.newConversationMenu'
  if (props.mode === 'new') return 'ai.workspace.newOnOtherTitle'
  return 'ai.workspace.switchHost'
}

function hintKey() {
  if (props.mode === 'create' || props.mode === 'new') return 'ai.workspace.scopeHint'
  return 'ai.workspace.switchHostHint'
}
</script>

<template>
  <div class="host-picker-layer" @keydown.esc.prevent="emit('close')">
    <button type="button" class="host-picker-backdrop" :aria-label="t('common.cancel')" @click="emit('close')" />
    <section
      ref="pickerRef"
      class="host-picker"
      :class="{ 'is-card-picker': mode !== 'switch' }"
      role="dialog"
      aria-modal="true"
      :aria-label="t(titleKey())"
      @keydown.tab="trapFocus"
    >
      <header>
        <div>
          <h3>{{ t(titleKey()) }}</h3>
          <p>{{ t(hintKey()) }}</p>
        </div>
        <button
          type="button"
          class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-close"
          :title="t('common.cancel')"
          :aria-label="t('common.cancel')"
          @click="emit('close')"
        >
          <AppIcon name="close" size="sm" />
        </button>
      </header>
      <label class="host-picker-search-field">
        <AppIcon v-if="mode !== 'switch'" name="search" size="sm" aria-hidden="true" />
        <input
          ref="searchRef"
          v-model="query"
          class="workspace-search host-picker-search"
          :placeholder="t('ai.workspace.pickHostSearch')"
          :aria-label="t('ai.workspace.pickHostSearch')"
          autofocus
        />
      </label>
      <p v-if="!pickerHosts.length" class="rail-empty">{{ t('ai.workspace.pickHostEmpty') }}</p>
      <div v-else class="host-picker-list">
        <section v-for="section in pickerGroups" :key="section.id" class="host-picker-group">
          <button
            type="button"
            class="host-picker-group-heading"
            :aria-expanded="!isGroupCollapsed(section.id)"
            :disabled="!!query.trim()"
            @click="emit('toggle-group', section.id)"
          >
            <AppIcon :name="isGroupCollapsed(section.id) ? 'chevron-right' : 'chevron-down'" size="xs" />
            <AppIcon name="folder" size="sm" />
            <strong :title="section.name">{{ section.name }}</strong>
            <span>{{ t('ai.workspace.groupCount', { count: section.hosts.length }) }}</span>
          </button>
          <div v-show="!isGroupCollapsed(section.id)" class="host-picker-group-items">
            <button
              v-for="connection in section.hosts"
              :key="connection.id"
              type="button"
              class="host-picker-item"
              :class="{
                pinned: connection.pinned === true,
                connected: !!sessions[connection.id],
                current: mode === 'switch' ? connection.id === selectedId : pickerSelection.includes(connection.id),
              }"
              :aria-pressed="mode !== 'switch' ? pickerSelection.includes(connection.id) : undefined"
              :disabled="!!connectingId || closing || scopeBusy || (mode !== 'switch' && !pickerSelection.includes(connection.id) && pickerSelection.length >= AI_WORKSPACE_MAX_HOSTS)"
              @click="emit('pick', connection)"
            >
              <span v-if="mode !== 'switch'" class="host-picker-server-icon" aria-hidden="true">
                <AppIcon name="server" size="sm" />
              </span>
              <span class="host-picker-item-main">
                <span class="workspace-host-label">
                  <strong :title="connection.name">{{ connection.name }}</strong>
                  <span
                    v-if="connection.pinned"
                    class="workspace-pin"
                    role="img"
                    :title="t('connections.pinned')"
                    :aria-label="t('connections.pinned')"
                  >
                    <AppIcon name="pin-fill" size="xs" />
                  </span>
                  <span
                    v-if="mode !== 'switch' && sessions[connection.id]"
                    class="connection-dot connected"
                    role="img"
                    :title="t('ai.workspace.connected')"
                    :aria-label="t('ai.workspace.connected')"
                  />
                </span>
                <span class="host-picker-address" :title="`${connection.username}@${connection.host}:${connection.port || 22}`">
                  {{ connection.username }}@{{ connection.host }}:{{ connection.port || 22 }}
                </span>
              </span>
              <span v-if="mode !== 'switch'" class="host-picker-check" aria-hidden="true">
                <AppIcon :name="pickerSelection.includes(connection.id) ? 'circle-check' : 'plus'" size="sm" />
              </span>
              <span v-else class="host-picker-item-meta">
                <span v-if="connection.id === selectedId">{{ t('ai.workspace.currentHost') }}</span>
                <span v-else-if="sessions[connection.id]">{{ t('ai.workspace.connected') }}</span>
                <span>{{ t('ai.workspace.switchHostAction') }}</span>
              </span>
            </button>
          </div>
        </section>
      </div>
      <p v-if="pickerError" class="workspace-error" role="alert">{{ pickerError }}</p>
      <footer v-if="mode !== 'switch'" class="host-picker-footer">
        <div class="host-picker-selection-summary">
          <span aria-live="polite">{{ t('ai.workspace.scopeSelected', { count: pickerSelection.length, max: AI_WORKSPACE_MAX_HOSTS }) }}</span>
          <ul v-if="selectedHosts.length" class="host-picker-selected-hosts" :aria-label="t('ai.workspace.selectedServers')">
            <li v-for="host in selectedHosts" :key="host.id">
              <button
                type="button"
                class="host-picker-selected-host"
                :title="`${host.name} · ${host.username}@${host.host}:${host.port || 22}`"
                :aria-label="t('ai.workspace.removeSelected', { name: host.name })"
                :disabled="scopeBusy || closing || !!connectingId"
                @click="removeSelection(host.id, $event)"
              >
                <span>{{ host.name }}</span>
                <AppIcon name="close" size="xs" aria-hidden="true" />
              </button>
            </li>
          </ul>
        </div>
        <div class="host-picker-actions">
          <button
            type="button"
            class="ui-btn ui-btn-ghost ui-btn-sm host-picker-clear-selection"
            :disabled="!pickerSelection.length || scopeBusy || closing || !!connectingId"
            @click="emit('clear-selection')"
          >
            {{ t('ai.workspace.clearSelection') }}
          </button>
          <button v-if="connectingId" type="button" class="ui-btn ui-btn-sm" @click="emit('cancel-connect')">{{ t('common.cancel') }}</button>
          <button
            type="button"
            class="ui-btn ui-btn-primary ui-btn-sm"
            :disabled="!pickerSelection.length || scopeBusy || !!connectingId"
            @click="emit('start-scope', pickerSelection)"
          >
            {{ t(scopeBusy ? 'ai.workspace.connecting' : 'ai.workspace.scopeStart') }}
          </button>
        </div>
      </footer>
    </section>
  </div>
</template>

<style scoped src="./aiWorkspaceShared.css"></style>

<style scoped>
.host-picker-layer:has(.is-card-picker) {
  align-items: center;
  padding: clamp(12px, 3vh, 28px) clamp(12px, 3vw, 32px);
}

.is-card-picker {
  box-sizing: border-box;
  width: min(1100px, 100%);
  max-height: min(760px, 100%);
  padding: clamp(14px, 2.2vw, 24px);
}

.host-picker-search-field { position: relative; display: block; flex-shrink: 0; }
.is-card-picker .host-picker-search-field > svg {
  position: absolute;
  top: 50%;
  inset-inline-start: 12px;
  transform: translateY(-50%);
  color: var(--text-secondary);
  pointer-events: none;
}
.is-card-picker .host-picker-search { min-height: var(--control-h); padding-inline-start: 34px; }

.is-card-picker .host-picker-list { padding: 2px 3px 4px; margin-inline: -3px; }
.is-card-picker .host-picker-group-heading { padding: 5px 8px; background: transparent; }
.is-card-picker .host-picker-group-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 220px), 1fr));
  gap: var(--space-2);
  padding-top: 6px;
}
.is-card-picker .host-picker-item {
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
  min-height: 58px;
  gap: var(--space-2);
  padding: 8px 10px;
  border-color: var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
}
.is-card-picker .host-picker-item:hover:not(:disabled) {
  background: var(--tab-hover-surface);
  border-color: color-mix(in srgb, var(--text-primary) 25%, var(--border-color));
}
.is-card-picker .host-picker-item.current {
  background: var(--accent-bg);
  border-color: color-mix(in srgb, var(--accent) 70%, var(--border-color));
}
.is-card-picker .host-picker-item.connected { box-shadow: none; }
.is-card-picker .host-picker-item-main { flex: 1; gap: 3px; }
.is-card-picker .host-picker-item-main strong { font-size: var(--font-ui-sm); }
.is-card-picker .host-picker-address {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--font-caption);
}
.host-picker-server-icon {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--text-primary) 7%, transparent);
  color: var(--text-secondary);
}
.is-card-picker .host-picker-check { display: inline-flex; flex-shrink: 0; }
.is-card-picker .host-picker-item:not(.current) .host-picker-check { color: var(--text-secondary); }
.is-card-picker .host-picker-item.current .host-picker-server-icon { color: var(--accent); }
.is-card-picker .host-picker-footer { flex-wrap: wrap; gap: var(--space-2); }
.host-picker-selection-summary {
  display: flex;
  flex: 1 1 300px;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px var(--space-2);
  min-width: 0;
}
.host-picker-selected-hosts {
  display: flex;
  flex: 1 1 150px;
  flex-wrap: wrap;
  align-content: flex-start;
  gap: 4px;
  min-width: 0;
  max-height: 64px;
  margin: 0;
  padding: 2px;
  overflow: auto;
  list-style: none;
}
.host-picker-selected-hosts > li { min-width: 0; max-width: min(100%, 200px); }
.host-picker-selected-host {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  max-width: 100%;
  padding: 3px 7px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--accent-bg);
  color: var(--text-primary);
  font: inherit;
  font-size: var(--font-caption);
  cursor: pointer;
}
.host-picker-selected-host span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.host-picker-selected-host svg { flex-shrink: 0; color: var(--text-secondary); }
.host-picker-selected-host:hover:not(:disabled) { border-color: var(--accent); }
.host-picker-selected-host:disabled { opacity: 0.55; cursor: not-allowed; }
.host-picker-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin-inline-start: auto;
}
</style>
