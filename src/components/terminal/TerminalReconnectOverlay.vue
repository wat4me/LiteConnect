<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{
  disconnected: boolean
  reconnecting: boolean
  attempt: number
  maxRetries: number
  exhausted: boolean
  neverConnected?: boolean
  /** Short reason under the title (unresponsive / closed / timeout). */
  detail?: string
}>()

const emit = defineEmits<{
  (e: 'reconnect'): void
  (e: 'cancel-auto'): void
  (e: 'keydown', event: KeyboardEvent): void
}>()

const { t } = useI18n()
const overlayEl = ref<HTMLDivElement | null>(null)

watch(
  () => props.disconnected,
  (val) => {
    if (val) {
      nextTick(() => {
        overlayEl.value?.focus()
      })
    }
  },
)
</script>

<template>
  <div
    v-if="disconnected"
    ref="overlayEl"
    class="reconnect-overlay"
    tabindex="-1"
    @keydown="emit('keydown', $event)"
  >
    <div class="reconnect-card">
      <AppIcon name="refresh" size="2xl" />
      <span class="reconnect-text">
        <template v-if="reconnecting">
          {{ t('terminal.reconnecting', { attempt, max: maxRetries }) }}
        </template>
        <template v-else-if="exhausted">
          {{ t('terminal.reconnectExhausted', { max: maxRetries }) }}
        </template>
        <template v-else-if="neverConnected">
          {{ t('terminal.clickToConnect') }}
        </template>
        <template v-else>
          {{ t('terminal.disconnected') }}
        </template>
      </span>
      <span
        v-if="detail && !reconnecting && !neverConnected"
        class="reconnect-detail"
      >{{ detail }}</span>
      <button class="reconnect-btn" type="button" @click="emit('reconnect')">
        {{ reconnecting ? t('terminal.reconnectNow') : (neverConnected ? t('terminal.connectNow') : t('terminal.reconnect')) }}
      </button>
      <button
        v-if="reconnecting"
        class="reconnect-btn ghost"
        type="button"
        @click="emit('cancel-auto')"
      >
        {{ t('terminal.cancelAutoReconnect') }}
      </button>
      <span class="reconnect-hint">{{ t('terminal.reconnectHint') }}</span>
    </div>
  </div>
</template>

<style scoped>
.reconnect-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  backdrop-filter: blur(2px);
}

.reconnect-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 32px;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  color: var(--text-secondary);
}

.reconnect-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.reconnect-detail {
  font-size: 12px;
  color: var(--text-secondary);
}

.reconnect-btn {
  padding: 8px 24px;
  background: var(--accent);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s;
}

.reconnect-btn:hover {
  background: var(--accent-hover);
}

.reconnect-btn.ghost {
  background: transparent;
  border: 1px solid var(--border-color);
  color: var(--text-primary);
  font-weight: 500;
}

.reconnect-btn.ghost:hover {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-bg);
}

.reconnect-hint {
  font-size: 11px;
  color: var(--text-secondary);
}

.reconnect-hint kbd {
  display: inline-block;
  padding: 1px 6px;
  font-size: 11px;
  font-family: inherit;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
}
</style>
