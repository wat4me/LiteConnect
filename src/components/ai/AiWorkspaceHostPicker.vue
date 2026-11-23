<script setup lang="ts">
import { useTemplateRef } from 'vue'
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
  (e: 'start-scope', connectionIds: string[]): void
}>()

const { t } = useI18n()
const pickerEl = useTemplateRef<HTMLElement>('pickerRef')
defineExpose({ pickerEl })

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
      <input
        v-model="query"
        class="workspace-search host-picker-search"
        :placeholder="t('ai.workspace.pickHostSearch')"
        :aria-label="t('ai.workspace.pickHostSearch')"
        autofocus
      />
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
                </span>
                <span>{{ connection.username }}@{{ connection.host }}:{{ connection.port || 22 }}</span>
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
        <span>{{ t('ai.workspace.scopeSelected', { count: pickerSelection.length, max: AI_WORKSPACE_MAX_HOSTS }) }}</span>
        <button v-if="connectingId" type="button" class="ui-btn ui-btn-sm" @click="emit('cancel-connect')">{{ t('common.cancel') }}</button>
        <button
          type="button"
          class="ui-btn ui-btn-primary ui-btn-sm"
          :disabled="!pickerSelection.length || scopeBusy || !!connectingId"
          @click="emit('start-scope', pickerSelection)"
        >
          {{ t(scopeBusy ? 'ai.workspace.connecting' : 'ai.workspace.scopeStart') }}
        </button>
      </footer>
    </section>
  </div>
</template>

<style scoped src="./aiWorkspaceShared.css"></style>
