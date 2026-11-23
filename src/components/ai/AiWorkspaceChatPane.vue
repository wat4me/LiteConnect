<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import type { AiWorkspaceScope, AiWorkspaceTarget } from '@shared/aiWorkspace'
import type { Connection } from '@shared/types/connection'
import AppIcon from '@/components/icons/AppIcon.vue'
import AiSidebar from './AiSidebar.vue'

defineProps<{
  sessionId: string
  revealGeneration: number
  activeScope: AiWorkspaceScope | null
  scopeTargets?: AiWorkspaceTarget[]
  scopeReady: boolean
  scopeBusy: boolean
  disconnectedScopeTargets: AiWorkspaceTarget[]
  disconnectedScopeNames: string
  selected?: Connection
  selectedId: string
  connectingId: string
  closing: boolean
  selectionLocked: boolean
  error: string
  active: boolean
  hideSwitchHost?: boolean
  /** Text to submit once this conversation is ready (for example a pre-connection draft). */
  selectionRequest?: { id: number; sessionId: string; text: string; mode: 'send' | 'insert' } | null
}>()

const emit = defineEmits<{
  (e: 'request-other-host-chat'): void
  (e: 'disconnect'): void
  (e: 'conversation-cleared'): void
  (e: 'switch-host'): void
  (e: 'retry-scope', scopeId: string): void
  (e: 'retry-connect'): void
  (e: 'cancel-connect'): void
  (e: 'close-session'): void
  (e: 'selection-consumed', id: number): void
}>()

const { t } = useI18n()
</script>

<template>
  <div class="workspace-chat">
    <p v-if="disconnectedScopeTargets.length" class="workspace-error inset" role="alert">
      {{ t('ai.workspace.scopeDisconnected', { hosts: disconnectedScopeNames }) }}
    </p>
    <p v-if="error && sessionId" class="workspace-error inset" role="alert">{{ error }}</p>
    <div v-if="sessionId" class="lite-ai-chat">
      <AiSidebar
        :key="sessionId"
        :session-id="sessionId"
        :open-generation="revealGeneration"
        :workspace-targets="scopeTargets"
        :disconnect-available="activeScope ? !!scopeTargets?.some(target => !!target.sessionId) : !!sessionId"
        :connection-busy="selectionLocked"
        :execution-available="!activeScope || scopeReady"
        :active="active"
        :selection-request="selectionRequest"
        workspace
        @selection-consumed="emit('selection-consumed', $event)"
        @request-other-host-chat="emit('request-other-host-chat')"
        @disconnect-ssh="emit('disconnect')"
        @conversation-cleared="emit('conversation-cleared')"
      >
        <template v-if="$slots['header-leading']" #header-leading>
          <slot name="header-leading" />
        </template>
        <template #workspace-toolbar>
          <header v-if="activeScope" class="workspace-target workspace-scope-target">
            <details class="workspace-scope-details">
              <summary :title="t('ai.workspace.serverDetails')">
                <span class="workspace-scope-ratio" :class="{ ready: scopeReady }">
                  {{ t('ai.workspace.scopeConnectionRatio', { connected: activeScope.connectionIds.length - disconnectedScopeTargets.length, count: activeScope.connectionIds.length }) }}
                </span>
                <AppIcon name="chevron-down" size="xs" class="workspace-scope-chevron" aria-hidden="true" />
              </summary>
              <div class="workspace-scope-popover">
                <div class="workspace-scope-heading">
                  <strong>{{ t('ai.workspace.scopeDetailsTitle') }}</strong>
                  <p>{{ t('ai.workspace.scopeDetailsHint') }}</p>
                </div>
                <ul>
                  <li v-for="target in scopeTargets" :key="target.connectionId">
                    <span class="connection-dot" :class="{ connected: !!target.sessionId }" aria-hidden="true" />
                    <strong>{{ target.name }}</strong>
                    <span v-if="target.host" class="workspace-scope-address">{{ target.username }}@{{ target.host }}:{{ target.port }}</span>
                    <span class="workspace-scope-status">{{ t(target.sessionId ? 'ai.workspace.connected' : 'ai.workspace.disconnected') }}</span>
                  </li>
                </ul>
              </div>
            </details>
            <button
              v-if="!scopeReady"
              type="button"
              class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm workspace-retry"
              :disabled="scopeBusy"
              :title="t('ai.workspace.retryConnect')"
              :aria-label="t('ai.workspace.retryConnect')"
              @click="emit('retry-scope', activeScope.id)"
            >
              <AppIcon name="refresh" size="sm" />
            </button>
          </header>
          <header v-else-if="selected" class="workspace-target">
            <div v-if="hideSwitchHost" class="workspace-target-host is-static" :title="`${selected.name} (${selected.username}@${selected.host}:${selected.port || 22})`">
              <strong>{{ selected.name }}</strong>
              <span>{{ selected.username }}@{{ selected.host }}:{{ selected.port || 22 }}</span>
            </div>
            <button
              v-else
              type="button"
              class="ui-btn ui-btn-sm workspace-target-host"
              :title="t('ai.workspace.switchHost')"
              :disabled="!!connectingId || closing"
              @click="emit('switch-host')"
            >
              <strong>{{ selected.name }}</strong>
              <span>{{ selected.username }}@{{ selected.host }}:{{ selected.port || 22 }}</span>
              <AppIcon name="chevron-down" size="xs" />
            </button>
            <span class="workspace-target-status" :class="{ connected: !!sessionId, connecting: connectingId === selected.id }">
              <span class="connection-dot" :class="{ connected: !!sessionId, connecting: connectingId === selected.id }" />
              {{ connectingId === selected.id ? t('ai.workspace.connecting') : sessionId ? t('ai.workspace.connected') : t('ai.workspace.disconnected') }}
            </span>
          </header>
        </template>
        <template #header-trailing>
          <slot name="header-trailing">
            <button
              v-if="selected && connectingId === selected.id"
              type="button"
              class="ui-btn ui-btn-ghost ui-btn-xs workspace-session-action"
              @click="emit('cancel-connect')"
            >
              <AppIcon name="close" size="sm" />
              {{ t('common.cancel') }}
            </button>
            <button
              v-else
              type="button"
              class="ui-icon-btn ui-icon-btn-close workspace-session-action workspace-close-session"
              :disabled="selectionLocked"
              :title="t('ai.workspace.closeHint')"
              :aria-label="t('ai.workspace.closeScope')"
              @click="emit('close-session')"
            >
              <AppIcon name="close" size="sm" />
            </button>
          </slot>
        </template>
      </AiSidebar>
    </div>
    <div v-else class="workspace-connect-panel" role="status">
      <AppIcon name="server" size="md" />
      <h3>{{ connectingId === selectedId ? t('ai.workspace.connectingTitle') : t('ai.workspace.connectFailedTitle') }}</h3>
      <p>{{ connectingId === selectedId ? t('ai.workspace.connectingHint') : (error || t('ai.workspace.connectFailedHint')) }}</p>
      <div v-if="connectingId" class="workspace-connect-actions">
        <button type="button" class="ui-btn ui-btn-sm" @click="emit('cancel-connect')">{{ t('common.cancel') }}</button>
      </div>
      <div v-if="connectingId !== selectedId" class="workspace-connect-actions">
        <button type="button" class="ui-btn ui-btn-primary ui-btn-sm" :disabled="closing || !!connectingId" @click="emit('retry-connect')">
          {{ t('ai.workspace.retryConnect') }}
        </button>
        <button v-if="!hideSwitchHost" type="button" class="ui-btn ui-btn-sm" :disabled="closing || !!connectingId" @click="emit('switch-host')">
          {{ t('ai.workspace.switchHost') }}
        </button>
        <slot name="connect-secondary-actions" />
      </div>
    </div>
  </div>
</template>

<style scoped src="./aiWorkspaceShared.css"></style>
