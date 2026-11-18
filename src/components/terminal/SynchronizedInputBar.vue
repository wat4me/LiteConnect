<script setup lang="ts">
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import type { BatchCommandTarget } from '@/domain/snippets/types'
import { synchronizedInputKey } from '@/composables/terminal/useSynchronizedInput'
import AppIcon from '../icons/AppIcon.vue'
const props = defineProps<{ sessions: BatchCommandTarget[]; open: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()
const sync = inject(synchronizedInputKey)!
const { t } = useI18n()
const names = computed(() => props.sessions.filter(s => sync.targets.value.includes(s.id)).map(s => s.displayName).join('、'))
const writableIds = computed(() => props.sessions.map(s => s.id).filter(id => sync.available(id)))
const canStartSync = computed(() => sync.targets.value.length >= 2 || writableIds.value.length >= 2)

function focusActiveTerminal() {
  const input = document.querySelector<HTMLElement>('.terminal-pane.active .xterm-helper-textarea, .xterm-helper-textarea')
  input?.focus()
}

function toggle(id: string, checked: boolean) {
  const wasEnabled = sync.enabled.value
  const next = checked ? [...sync.selected.value, id] : sync.selected.value.filter(value => value !== id)
  sync.select(next)
  if (wasEnabled && sync.targets.value.length >= 2) sync.start()
}

function selectAll() {
  const wasEnabled = sync.enabled.value
  sync.select(writableIds.value)
  if (wasEnabled && sync.targets.value.length >= 2) sync.start()
}

function selectNone() {
  sync.select([])
}

function handleStart() {
  if (sync.targets.value.length < 2 && writableIds.value.length >= 2) {
    sync.select(writableIds.value)
  }
  if (sync.start()) {
    focusActiveTerminal()
  }
}
</script>
<template>
  <section
    v-if="open || sync.enabled.value"
    class="sync-input-bar"
    :class="{ enabled: sync.enabled.value }"
    :aria-label="t('terminal.syncTitle')"
  >
    <div class="sync-heading">
      <span v-if="sync.enabled.value" class="sync-dot" aria-hidden="true" />
      <strong>{{ t('terminal.syncTitle') }}</strong>
      <span class="sync-badge" :class="{ active: sync.enabled.value }">
        {{ sync.targets.value.length }}/{{ sessions.length }}
      </span>
      <span v-if="sync.enabled.value" class="sync-status" role="status">
        {{ t('terminal.syncActive', { count: sync.targets.value.length }) }} · {{ names }}
      </span>
      <span v-else class="sync-hint-text">{{ t('terminal.syncHint') }}</span>

      <div class="sync-actions">
        <template v-if="open">
          <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="selectAll">{{ t('terminal.syncSelectAll') }}</button>
          <button type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="selectNone">{{ t('terminal.syncSelectNone') }}</button>
        </template>
        <button
          v-if="sync.enabled.value"
          class="ui-btn ui-btn-xs ui-btn-danger"
          type="button"
          @click="sync.stop()"
        >
          {{ t('terminal.syncStop') }}
        </button>
        <button
          v-else
          class="ui-btn ui-btn-xs ui-btn-primary"
          type="button"
          :disabled="!canStartSync"
          @click="handleStart"
        >
          {{ t('terminal.syncStart') }}
        </button>
        <button
          v-if="open"
          class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close"
          type="button"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          <AppIcon name="close" size="sm" />
        </button>
      </div>
    </div>

    <div v-if="open && sessions.length > 0" class="sync-targets">
      <label
        v-for="session in sessions"
        :key="session.id"
        class="sync-target"
        :class="{ selected: sync.selected.value.includes(session.id), disabled: !sync.available(session.id) }"
        :title="session.sshAddress"
      >
        <input
          type="checkbox"
          :checked="sync.selected.value.includes(session.id)"
          :disabled="!sync.available(session.id)"
          @change="toggle(session.id, ($event.target as HTMLInputElement).checked)"
        />
        <span class="sync-target-name">{{ session.displayName }}</span>
      </label>
    </div>
  </section>
</template>
<style scoped>
.sync-input-bar {
  flex-shrink: 0;
  min-width: 0;
  padding: 7px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: var(--font-ai-detail, 12px);
}

.sync-input-bar.enabled {
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-secondary));
  border-bottom-color: color-mix(in srgb, var(--accent) 35%, var(--border-color));
}

.sync-heading {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.sync-heading strong {
  color: var(--text-primary);
  font-weight: 600;
}

.sync-badge {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: var(--font-caption);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.sync-badge.active {
  background: var(--accent-bg);
  color: var(--accent);
}

.sync-status {
  overflow-wrap: anywhere;
  flex: 1;
  min-width: 120px;
  color: var(--text-primary);
  font-weight: 500;
}

.sync-hint-text {
  flex: 1;
  min-width: 120px;
  overflow-wrap: anywhere;
}

.sync-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-shrink: 0;
}

.sync-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  flex-shrink: 0;
}

.sync-targets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
  max-height: 96px;
  overflow-y: auto;
}

.sync-target {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  max-width: 100%;
  padding: 3px 9px;
  border-radius: var(--radius-md);
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.sync-target:hover:not(.disabled) {
  background: var(--bg-secondary);
  border-color: color-mix(in srgb, var(--text-primary) 16%, var(--border-color));
}

.sync-target.selected {
  background: var(--tab-selected-surface);
  border-color: color-mix(in srgb, var(--text-primary) 24%, var(--border-color));
}

.sync-target.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.sync-target input {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  margin: 0;
  accent-color: var(--accent);
}

.sync-target-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
