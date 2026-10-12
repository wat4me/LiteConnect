<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BatchCommandTarget } from '@/domain/snippets/types'
import { synchronizedInputKey } from '@/composables/terminal/useSynchronizedInput'
const props = defineProps<{ sessions: BatchCommandTarget[]; open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const sync = inject(synchronizedInputKey)!
const { t } = useI18n()
const names = computed(() => props.sessions.filter(s => sync.targets.value.includes(s.id)).map(s => s.displayName).join('、'))
function toggle(id: string, checked: boolean) {
  sync.select(checked ? [...sync.selected.value, id] : sync.selected.value.filter(value => value !== id))
}
</script>
<template>
  <section v-if="open || sync.enabled.value" class="sync-input-bar" :class="{ enabled: sync.enabled.value }" :aria-label="t('terminal.syncTitle')">
    <div class="sync-heading">
      <strong>{{ t('terminal.syncTitle') }}</strong>
      <span v-if="sync.enabled.value" class="sync-status" role="status">{{ t('terminal.syncActive', { count: sync.targets.value.length }) }} · {{ names }}</span>
      <span v-else>{{ t('terminal.syncHint') }}</span>
      <button v-if="sync.enabled.value" class="ui-btn ui-btn-sm" type="button" @click="sync.stop()">{{ t('terminal.syncStop') }}</button>
      <button v-else class="ui-btn ui-btn-sm ui-btn-primary" type="button" :disabled="sync.targets.value.length < 2" @click="sync.start()">{{ t('terminal.syncStart') }}</button>
      <button v-if="open" class="ui-btn ui-btn-sm" type="button" @click="emit('close')">{{ t('common.close') }}</button>
    </div>
    <div v-if="open" class="sync-targets">
      <label v-for="session in sessions" :key="session.id" class="sync-target" :title="session.sshAddress">
        <input type="checkbox" :checked="sync.selected.value.includes(session.id)" :disabled="!sync.available(session.id)" @change="toggle(session.id, ($event.target as HTMLInputElement).checked)" />
        <span>{{ session.displayName }}</span>
      </label>
    </div>
  </section>
</template>
<style scoped>
.sync-input-bar { flex-shrink: 0; min-width: 0; padding: 8px 12px; border-bottom: 1px solid var(--border); background: var(--bg-secondary); color: var(--text-secondary); font-size: 12px; }
.sync-input-bar.enabled { background: color-mix(in srgb, var(--accent) 12%, var(--bg-secondary)); border-bottom-color: var(--accent); }
.sync-heading { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.sync-heading strong { color: var(--text-primary); }
.sync-status { overflow-wrap: anywhere; flex: 1; min-width: 100px; color: var(--text-primary); }
.sync-targets { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-top: 8px; max-height: 120px; overflow: auto; }
.sync-target { display: inline-flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; cursor: pointer; }
.sync-target input { flex: 0 0 auto; width: 14px; height: 14px; margin: 0; accent-color: var(--accent); }
.sync-target span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
