<script setup lang="ts">
import { computed, onActivated, onDeactivated, onScopeDispose, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { chatActivityDisplay, type AiChatActivity } from '@/utils/ai/chatActivity'

const props = defineProps<{ activity?: AiChatActivity; createdAt: number }>()
const { t } = useI18n()
// Keep elapsed ticks local instead of rerendering every message and tool row.
const now = ref(Date.now())
const display = computed(() => chatActivityDisplay(props.activity || {
  phase: 'waiting', phaseStartedAt: props.createdAt, lastActivityAt: props.createdAt,
}, now.value))
let timer: ReturnType<typeof setInterval> | undefined
function stopClock() { if (timer) clearInterval(timer); timer = undefined }
function startClock() {
  stopClock()
  now.value = Date.now()
  timer = setInterval(() => { now.value = Date.now() }, 1000)
}
startClock()
onActivated(startClock)
onDeactivated(stopClock)
onScopeDispose(stopClock)
</script>

<template>
  <div class="reasoning-box live activity-status" role="status" aria-busy="true">
    <div class="activity-line">
      <span>{{ t(`ai.activity.${display.phase}`) }}</span>
      <span class="activity-elapsed">{{ t('ai.activityElapsed', { seconds: display.elapsedSeconds }) }}</span>
      <span class="thinking-dots" aria-hidden="true"><i /><i /><i /></span>
    </div>
    <div v-if="display.delayed" class="activity-delay">
      {{ t('ai.activityDelayed', { seconds: display.quietSeconds }) }}
    </div>
  </div>
</template>

<style scoped>
.activity-line { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.activity-elapsed { font-variant-numeric: tabular-nums; }
.activity-delay { color: var(--warning, var(--text-secondary)); overflow-wrap: anywhere; }
.thinking-dots { display: inline-flex; gap: 3px; }
.thinking-dots i { width: 5px; height: 5px; border-radius: 50%; background: var(--accent); opacity: 0.35; animation: ai-activity-pulse 1s ease-in-out infinite; }
.thinking-dots i:nth-child(2) { animation-delay: 0.15s; }
.thinking-dots i:nth-child(3) { animation-delay: 0.3s; }
@keyframes ai-activity-pulse {
  0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-2px); }
}
@media (prefers-reduced-motion: reduce) { .thinking-dots i { animation: none; } }
</style>
