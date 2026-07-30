<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  QUERY_MAX_ROWS_MAX,
  QUERY_MAX_ROWS_MIN,
  QUERY_TIMEOUT_MS_MAX,
  QUERY_TIMEOUT_MS_MIN,
  sanitizeQueryTabExecOptions,
  type QueryDefaultRunScopePref,
  type QueryTabExecOptions,
} from '@/utils/database/queryTabOptions'
import {
  applyLoadGlobalDangerousSql,
  applySaveGlobalDangerousSql,
  beginLoadGlobalDangerousSql,
  beginSaveGlobalDangerousSql,
  canToggleGlobalDangerousSql,
  initialGlobalDangerousSqlUi,
} from '@/utils/database/globalDangerousSqlSetting'
import { dispatchDbSettingsChange, getCachedDbSettings } from '@/composables/database/useDbSettings'
import { placePopupNearAnchor } from '@/utils/shared/popupPosition'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'
import AppIcon from '../icons/AppIcon.vue'

const { t } = useI18n()

const props = defineProps<{
  maxRows: number
  timeoutMs: number
  defaultRunScope: QueryDefaultRunScopePref
  disabled?: boolean
}>()

const emit = defineEmits<{
  apply: [opts: QueryTabExecOptions]
}>()

const open = ref(false)
const anchorRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const panelStyle = ref<{ top: string; left: string; width: string }>({
  top: '0px',
  left: '0px',
  width: '280px',
})

const draftMaxRows = ref(String(props.maxRows))
const draftTimeoutMs = ref(String(props.timeoutMs))
const draftScope = ref<QueryDefaultRunScopePref>(props.defaultRunScope)

/** Global dangerous-SQL confirm — not per-tab draft state. */
const globalDanger = ref(initialGlobalDangerousSqlUi(getCachedDbSettings().confirmDangerousSql))
/** Generation guards against stale async load/save after close/unmount. */
let dangerLoadGen = 0
let dangerSaveGen = 0

const scopeOptions = computed(() => [
  { value: 'smart' as const, label: t('database.query.settingsScopeSmart') },
  { value: 'selection' as const, label: t('database.query.settingsScopeSelection') },
  { value: 'statement' as const, label: t('database.query.settingsScopeStatement') },
  { value: 'all' as const, label: t('database.query.settingsScopeAll') },
])

const dangerToggleEnabled = computed(() => canToggleGlobalDangerousSql(globalDanger.value))

const dangerStatusText = computed(() => {
  if (globalDanger.value.loading) return t('database.query.settingsDangerousLoading')
  if (globalDanger.value.saving) return t('database.query.settingsDangerousSaving')
  if (globalDanger.value.error) return globalDanger.value.error
  if (!globalDanger.value.known) return t('database.query.settingsDangerousUnknown')
  return t('database.query.settingsDangerousGlobalHint')
})

function syncDraftFromProps() {
  draftMaxRows.value = String(props.maxRows)
  draftTimeoutMs.value = String(props.timeoutMs)
  draftScope.value = props.defaultRunScope
}

function positionPanel() {
  const btn = anchorRef.value
  if (!btn) return
  const rect = btn.getBoundingClientRect()
  const width = Math.min(320, Math.max(260, window.innerWidth - 16))
  const panelEl = panelRef.value
  const panelH = panelEl?.offsetHeight || 360
  const pos = placePopupNearAnchor(rect, { width, height: panelH }, { align: 'end', gap: 4 })
  panelStyle.value = {
    top: `${pos.top}px`,
    left: `${pos.left}px`,
    width: `${width}px`,
  }
}

function close(refocus = false) {
  if (!open.value) return
  open.value = false
  if (refocus) void nextTick(() => anchorRef.value?.focus())
}

async function loadGlobalDangerous() {
  const gen = ++dangerLoadGen
  globalDanger.value = beginLoadGlobalDangerousSql(globalDanger.value)
  try {
    const value = await window.LiteConnect.getDbConfirmDangerousSql()
    if (gen !== dangerLoadGen) return
    globalDanger.value = applyLoadGlobalDangerousSql(globalDanger.value, {
      ok: true,
      value: value !== false,
    })
    // Keep module cache in sync without full save
    const cached = getCachedDbSettings()
    if (cached.confirmDangerousSql !== (value !== false)) {
      dispatchDbSettingsChange({ ...cached, confirmDangerousSql: value !== false })
    }
  } catch (err: unknown) {
    if (gen !== dangerLoadGen) return
    const msg =
      err instanceof Error && err.message
        ? err.message
        : t('database.query.settingsDangerousLoadFailed')
    globalDanger.value = applyLoadGlobalDangerousSql(globalDanger.value, {
      ok: false,
      error: msg,
    })
  }
}

async function onDangerousToggle(ev: Event) {
  const input = ev.target as HTMLInputElement
  const next = !!input.checked
  if (!canToggleGlobalDangerousSql(globalDanger.value)) {
    // Revert optimistic DOM flip if mid-flight / unknown
    input.checked = globalDanger.value.value
    return
  }
  const previous = globalDanger.value.value
  const gen = ++dangerSaveGen
  globalDanger.value = beginSaveGlobalDangerousSql(globalDanger.value, next)
  try {
    await window.LiteConnect.setDbConfirmDangerousSql(next)
    if (gen !== dangerSaveGen) return
    globalDanger.value = applySaveGlobalDangerousSql(globalDanger.value, {
      ok: true,
      value: next,
    })
    const cached = getCachedDbSettings()
    dispatchDbSettingsChange({ ...cached, confirmDangerousSql: next })
  } catch (err: unknown) {
    if (gen !== dangerSaveGen) return
    const msg =
      err instanceof Error && err.message
        ? err.message
        : t('database.query.settingsDangerousSaveFailed')
    globalDanger.value = applySaveGlobalDangerousSql(globalDanger.value, {
      ok: false,
      error: msg,
      previousValue: previous,
    })
  }
}

function toggle() {
  if (props.disabled) return
  if (open.value) {
    close(false)
    return
  }
  syncDraftFromProps()
  open.value = true
  void loadGlobalDangerous()
  void nextTick(() => {
    positionPanel()
    const first = panelRef.value?.querySelector<HTMLInputElement>('input, select')
    first?.focus()
  })
}

function commit() {
  const next = sanitizeQueryTabExecOptions({
    maxRows: Number(draftMaxRows.value),
    timeoutMs: Number(draftTimeoutMs.value),
    defaultRunScope: draftScope.value,
  })
  emit('apply', next)
  draftMaxRows.value = String(next.maxRows)
  draftTimeoutMs.value = String(next.timeoutMs)
  draftScope.value = next.defaultRunScope
  // Global dangerous-SQL is saved immediately on toggle — not via Apply
  close(true)
}

function onViewportChange() {
  if (open.value) positionPanel()
}

useOutsideDismiss(
  open,
  () => close(false),
  () => [anchorRef.value, panelRef.value],
)

onMounted(() => {
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
})

onBeforeUnmount(() => {
  dangerLoadGen += 1
  dangerSaveGen += 1
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
})

watch(
  () => [props.maxRows, props.timeoutMs, props.defaultRunScope] as const,
  () => {
    if (!open.value) syncDraftFromProps()
  },
)

defineExpose({
  close: () => close(false),
  isOpen: () => open.value,
})
</script>

<template>
  <div class="settings-wrap">
    <button
      ref="anchorRef"
      type="button"
      class="settings-btn"
      :disabled="disabled"
      :aria-expanded="open"
      aria-haspopup="dialog"
      :aria-label="t('database.query.settingsTitle')"
      :title="t('database.query.settingsTitle')"
      @click.stop="toggle"
    >
      <AppIcon name="settings" size="sm" />
    </button>
    <Teleport to="body">
      <div
        v-if="open"
        ref="panelRef"
        class="settings-panel"
        role="dialog"
        :aria-label="t('database.query.settingsTitle')"
        :style="panelStyle"
        @click.stop
      >
        <div class="settings-head">{{ t('database.query.settingsTitle') }}</div>
        <p class="settings-hint">{{ t('database.query.settingsTabHint') }}</p>
        <label class="settings-field">
          <span>{{ t('database.query.settingsMaxRows') }}</span>
          <input
            v-model="draftMaxRows"
            class="ui-input ui-input-sm"
            type="number"
            :min="QUERY_MAX_ROWS_MIN"
            :max="QUERY_MAX_ROWS_MAX"
            step="1"
          />
        </label>
        <label class="settings-field">
          <span>{{ t('database.query.settingsTimeout') }}</span>
          <input
            v-model="draftTimeoutMs"
            class="ui-input ui-input-sm"
            type="number"
            :min="QUERY_TIMEOUT_MS_MIN"
            :max="QUERY_TIMEOUT_MS_MAX"
            step="1000"
          />
        </label>
        <label class="settings-field">
          <span>{{ t('database.query.settingsDefaultScope') }}</span>
          <select v-model="draftScope" class="ui-input ui-input-sm">
            <option v-for="opt in scopeOptions" :key="opt.value" :value="opt.value">
              {{ opt.label }}
            </option>
          </select>
        </label>

        <div class="settings-global-block">
          <div class="settings-global-label">{{ t('database.query.settingsGlobalSection') }}</div>
          <label class="settings-check" :class="{ disabled: !dangerToggleEnabled }">
            <input
              type="checkbox"
              :checked="globalDanger.value"
              :disabled="!dangerToggleEnabled"
              :aria-busy="globalDanger.loading || globalDanger.saving"
              @change="onDangerousToggle"
            />
            <span>{{ t('database.query.settingsDangerousSql') }}</span>
          </label>
          <p
            class="settings-global-note"
            :class="{ err: !!globalDanger.error }"
            role="status"
          >
            {{ dangerStatusText }}
          </p>
        </div>

        <div class="settings-actions">
          <button type="button" class="ui-btn ui-btn-xs" @click="close(true)">
            {{ t('common.cancel') }}
          </button>
          <button type="button" class="ui-btn ui-btn-xs ui-btn-primary" @click="commit">
            {{ t('common.apply') }}
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.settings-wrap {
  display: inline-flex;
  position: relative;
}

.settings-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  line-height: 1;
}

.settings-btn:hover:not(:disabled) {
  color: var(--text-primary);
  border-color: var(--accent);
}

.settings-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.settings-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.settings-panel {
  position: fixed;
  z-index: 120;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px 12px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.35);
  max-width: min(320px, calc(100vw - 16px));
}

.settings-head {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
}

.settings-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.settings-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-secondary);
}

.settings-field input,
.settings-field select {
  width: 100%;
}

.settings-global-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 4px;
  border-top: 1px solid var(--border-color);
}

.settings-global-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
}

.settings-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
}

.settings-check.disabled {
  opacity: 0.65;
  cursor: not-allowed;
}

.settings-check input {
  margin-top: 2px;
  flex-shrink: 0;
}

.settings-global-note {
  margin: 0;
  font-size: 10px;
  color: var(--text-secondary);
  line-height: 1.35;
  opacity: 0.95;
}

.settings-global-note.err {
  color: var(--danger, #f85149);
  opacity: 1;
}

.settings-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
  margin-top: 2px;
}
</style>
