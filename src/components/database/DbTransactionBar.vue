<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { createTxDurationTimer } from '@/utils/database/txDurationTimer'

const { t } = useI18n()

const props = defineProps<{
  inTransaction: boolean
  loading: boolean
  sessionAlive: boolean
  /** Epoch ms when tx began; null when not in tx */
  transactionStartedAt?: number | null
}>()

const emit = defineEmits<{
  beginTx: []
  commitTx: []
  rollbackTx: []
}>()

const durationText = ref('0:00')
const timer = createTxDurationTimer({
  onTick: (ms) => {
    durationText.value = timer.format(ms)
  },
})

function syncTimer() {
  if (props.inTransaction && props.transactionStartedAt != null) {
    timer.start(props.transactionStartedAt)
    durationText.value = timer.format(timer.elapsedMs())
  } else {
    timer.stop()
    durationText.value = '0:00'
  }
}

watch(
  () => [props.inTransaction, props.transactionStartedAt] as const,
  () => syncTimer(),
  { immediate: true },
)

onBeforeUnmount(() => {
  timer.stop()
})
</script>

<template>
  <div class="tx-bar" :class="{ active: inTransaction }">
    <span
      class="tx-badge"
      :class="{ active: inTransaction }"
      :title="inTransaction ? t('database.tx.inTransaction') : t('database.tx.autocommit')"
    >
      {{ inTransaction ? t('database.tx.inTransaction') : t('database.tx.autocommit') }}
    </span>
    <span v-if="inTransaction" class="tx-duration">
      {{ t('database.tx.duration', { time: durationText }) }}
    </span>
    <div class="tx-actions">
      <button
        v-if="!inTransaction"
        type="button"
        class="ui-btn ui-btn-sm"
        :disabled="loading || !sessionAlive"
        :title="t('database.tx.beginTitle')"
        @click="emit('beginTx')"
      >
        {{ t('database.tx.begin') }}
      </button>
      <template v-else>
        <button
          type="button"
          class="ui-btn ui-btn-sm"
          :disabled="loading || !sessionAlive"
          @click="emit('commitTx')"
        >
          {{ t('database.tx.commit') }}
        </button>
        <button
          type="button"
          class="ui-btn ui-btn-sm ui-btn-danger"
          :disabled="loading || !sessionAlive"
          @click="emit('rollbackTx')"
        >
          {{ t('database.tx.rollback') }}
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.tx-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 4px 10px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
  min-height: 32px;
}

.tx-bar.active {
  background: color-mix(in srgb, var(--warning, #d29922) 10%, var(--bg-secondary));
  border-bottom-color: color-mix(in srgb, var(--warning, #d29922) 35%, var(--border-color));
}

.tx-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  white-space: nowrap;
}

.tx-badge.active {
  border-color: var(--warning, #d29922);
  color: var(--warning, #d29922);
  background: color-mix(in srgb, var(--warning, #d29922) 12%, transparent);
  font-weight: 700;
}

.tx-duration {
  font-size: 11px;
  font-family: var(--font-mono, 'Cascadia Code', Consolas, monospace);
  color: var(--warning, #d29922);
}

.tx-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
</style>
