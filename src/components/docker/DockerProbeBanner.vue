<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'
import type { DockerAvailability } from '../../env.d'

const props = defineProps<{
  sessionId: string | null
  sshDisconnected?: boolean
  availability: DockerAvailability | null
  probeUiKind: 'loading' | 'result' | 'error' | 'idle'
  probing: boolean
  refreshing: boolean
}>()

const emit = defineEmits<{
  (e: 'back-to-terminal'): void
  (e: 'reconnect'): void
  (e: 'refresh'): void
}>()

const { t } = useI18n()

const busy = computed(() => props.probing || props.refreshing)
const canRefresh = computed(
  () => !!props.sessionId && !props.sshDisconnected && !busy.value,
)

const statusKey = computed(() => {
  if (!props.sessionId) return 'no-session'
  if (props.sshDisconnected) return 'ssh-disconnected'
  if (props.probeUiKind === 'loading' && !props.availability) return 'loading'
  if (props.probeUiKind === 'error') return 'probe-failed'
  if (!props.availability) return 'loading'
  return props.availability.status
})

const statusLabel = computed(() => {
  switch (statusKey.value) {
    case 'available':
      return t('docker.status.available')
    case 'not-installed':
      return t('docker.status.notInstalled')
    case 'api-version-incompatible':
      return t('docker.status.apiVersionIncompatible')
    case 'daemon-unavailable':
      return t('docker.status.daemonUnavailable')
    case 'permission-denied':
      return t('docker.status.permissionDenied')
    case 'transport-unsupported':
      return t('docker.status.transportUnsupported')
    case 'socket-forward-failed':
      return t('docker.status.socketForwardFailed')
    case 'ssh-disconnected':
      return t('docker.status.sshDisconnected')
    case 'probe-failed':
      return t('docker.status.probeFailed')
    case 'no-session':
      return t('docker.status.noSession')
    default:
      return t('docker.status.loading')
  }
})

const statusHint = computed(() => {
  const a = props.availability
  switch (statusKey.value) {
    case 'available':
      return t('docker.hint.available')
    case 'not-installed':
      return t('docker.hint.notInstalled')
    case 'api-version-incompatible':
      return a && a.status === 'api-version-incompatible'
        ? t('docker.hint.apiVersionIncompatible', {
            detected: a.apiVersion,
            required: a.requiredApiVersion,
          })
        : t('docker.hint.probeFailed')
    case 'daemon-unavailable':
      return t('docker.hint.daemonUnavailable')
    case 'permission-denied':
      return t('docker.hint.permissionDenied')
    case 'transport-unsupported':
      return t('docker.hint.transportUnsupported')
    case 'socket-forward-failed':
      return t('docker.hint.socketForwardFailed')
    case 'ssh-disconnected':
      return t('docker.hint.sshDisconnected')
    case 'probe-failed':
      return t('docker.hint.probeFailed')
    case 'no-session':
      return t('docker.hint.noSession')
    default:
      return t('docker.hint.loading')
  }
})

const statusTone = computed(() => {
  switch (statusKey.value) {
    case 'available':
      return 'ok'
    case 'loading':
      return 'muted'
    case 'ssh-disconnected':
    case 'probe-failed':
    case 'no-session':
      return 'danger'
    case 'socket-forward-failed':
    case 'transport-unsupported':
      return 'warn'
    default:
      return 'warn'
  }
})

const engineVersion = computed(() => {
  const a = props.availability
  return a && (a.status === 'available' || a.status === 'api-version-incompatible')
    ? a.engineVersion
    : ''
})

const apiVersion = computed(() => {
  const a = props.availability
  return a && (a.status === 'available' || a.status === 'api-version-incompatible')
    ? a.apiVersion
    : ''
})

const requiredApiVersion = computed(() => {
  const a = props.availability
  return a && a.status === 'api-version-incompatible' ? a.requiredApiVersion : ''
})

const dockerAvailable = computed(() => props.availability?.status === 'available')
</script>

<template>
  <header class="docker-header">
    <div class="docker-header-left">
      <AppIcon name="docker" size="lg" class="docker-title-icon" />
      <h2 class="docker-title">{{ t('docker.title') }}</h2>
      <span
        class="status-pill"
        :class="`tone-${statusTone}`"
        :aria-live="busy ? 'polite' : undefined"
      >
        <span class="status-dot" aria-hidden="true"></span>
        {{ statusLabel }}
      </span>
      <span
        v-if="engineVersion || apiVersion"
        class="version-meta compact"
        :title="[
          engineVersion ? t('docker.engineVersion', { version: engineVersion }) : '',
          apiVersion ? t('docker.apiVersion', { version: apiVersion }) : '',
        ]
          .filter(Boolean)
          .join(' · ')"
      >
        <template v-if="engineVersion">{{ engineVersion }}</template>
        <template v-if="engineVersion && apiVersion"> · </template>
        <template v-if="apiVersion">API {{ apiVersion }}</template>
        <template v-if="requiredApiVersion"> · ≥ {{ requiredApiVersion }}</template>
      </span>
    </div>
    <div class="docker-header-actions">
      <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" @click="emit('back-to-terminal')">
        {{ t('docker.backToTerminal') }}
      </button>
      <button
        v-if="sshDisconnected && sessionId"
        type="button"
        class="ui-btn ui-btn-sm"
        @click="emit('reconnect')"
      >
        {{ t('docker.reconnect') }}
      </button>
      <button
        type="button"
        class="ui-btn ui-btn-sm"
        :disabled="!canRefresh"
        :aria-busy="busy"
        @click="emit('refresh')"
      >
        <span class="refresh-icon" :class="{ spinning: busy }">
          <AppIcon name="refresh" size="sm" />
        </span>
        {{ busy ? t('docker.refreshing') : t('docker.refresh') }}
      </button>
    </div>
  </header>

  <div v-if="!dockerAvailable" class="docker-body">
    <div class="status-card" :class="`tone-${statusTone}`">
      <p class="status-headline">{{ statusLabel }}</p>
      <p class="status-hint">{{ statusHint }}</p>
    </div>
  </div>
</template>

<style scoped>
@import './dockerShared.css';

.docker-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  min-width: 0;
}

.docker-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}

.docker-title-icon {
  color: var(--accent);
  flex-shrink: 0;
}

.docker-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  white-space: nowrap;
}

.version-meta {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.version-meta.compact {
  opacity: 0.85;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.docker-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.refresh-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 0;
}

.refresh-icon.spinning {
  animation: docker-spin 0.9s linear infinite;
}

@keyframes docker-spin {
  to {
    transform: rotate(360deg);
  }
}

.docker-body {
  flex: 1;
  min-height: 0;
  min-width: 0;
  overflow: auto;
  padding: 20px 16px;
}

.status-card {
  max-width: 560px;
  padding: 16px 18px;
  border-radius: 10px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
}

.status-card.tone-ok {
  border-color: color-mix(in srgb, var(--success) 35%, var(--border-color));
}

.status-card.tone-warn {
  border-color: color-mix(in srgb, var(--warning) 35%, var(--border-color));
}

.status-card.tone-danger {
  border-color: color-mix(in srgb, var(--danger) 35%, var(--border-color));
}

.status-headline {
  margin: 0 0 8px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.status-hint {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-secondary);
  word-break: break-word;
}
</style>
