<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'
import type { RunScope } from '@/utils/database/sqlStatement'
import { isRunMenuItemEnabled } from '@/utils/database/queryUiController'
import { clampPopupToViewport } from '@/utils/shared/popupPosition'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'
import './dbRunMenuPortal.css'

const { t } = useI18n()

const props = defineProps<{
  loading: boolean
  canCancel: boolean
  cancelling: boolean
  sessionAlive: boolean
  defaultScope: RunScope
  hasSelection: boolean
  canRunStatement: boolean
  hasSql: boolean
  readOnly: boolean
  isSaved: boolean
}>()

const emit = defineEmits<{
  run: [scope: RunScope]
  explain: []
  saveQuery: []
  cancel: []
}>()

const showScopeMenu = ref(false)
const runGroupRef = ref<HTMLElement | null>(null)
const scopeButton = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<{ top: string; left: string; minWidth: string }>({
  top: '0px',
  left: '0px',
  minWidth: '180px',
})

const runLabel = computed(() => {
  if (props.defaultScope === 'selection') return t('database.query.runSelection')
  if (props.defaultScope === 'statement') return t('database.query.runStatement')
  return t('database.query.runAll')
})
const scopeLabel = computed(() => {
  if (props.defaultScope === 'selection') return t('database.query.scopeLabelSelection')
  if (props.defaultScope === 'statement') return t('database.query.scopeLabelStatement')
  return t('database.query.scopeLabelAll')
})
const cancelLabel = computed(() =>
  t(props.cancelling ? 'database.query.cancelling' : 'database.query.cancel'),
)
const scopeDisabled = computed(() => !props.sessionAlive || props.loading || !props.hasSql)

function scopeEnabled(scope: RunScope) {
  if (scopeDisabled.value) return false
  return isRunMenuItemEnabled(scope, {
    hasSelection: props.hasSelection,
    canRunStatement: props.canRunStatement,
    sessionAlive: props.sessionAlive,
  })
}

function runDefault() {
  if (!scopeEnabled(props.defaultScope)) return
  closeScopeMenu(false)
  emit('run', props.defaultScope)
}

function runWith(scope: RunScope) {
  if (!scopeEnabled(scope)) return
  closeScopeMenu(false)
  emit('run', scope)
}

function positionMenu() {
  const btn = scopeButton.value
  if (!btn) return
  const rect = btn.getBoundingClientRect()
  const menuEl = menuRef.value
  const menuW = Math.max(200, menuEl?.offsetWidth || 200)
  const menuH = menuEl?.offsetHeight || 160
  const gap = 6
  const right = rect.right + gap
  const left = right + menuW <= window.innerWidth - 8 ? right : rect.left - menuW - gap
  const pos = clampPopupToViewport({ x: left, y: rect.top }, { width: menuW, height: menuH })
  menuStyle.value = {
    top: `${pos.top}px`,
    left: `${pos.left}px`,
    minWidth: `${menuW}px`,
  }
}

function closeScopeMenu(refocus = false) {
  if (!showScopeMenu.value) return
  showScopeMenu.value = false
  if (refocus) void nextTick(() => scopeButton.value?.focus())
}

function toggleScopeMenu() {
  if (scopeDisabled.value) return
  showScopeMenu.value = !showScopeMenu.value
  if (showScopeMenu.value) {
    void nextTick(() => {
      positionMenu()
      menuRef.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    })
  }
}

function moveScopeFocus(direction: number) {
  if (!menuRef.value) return
  const items = [...menuRef.value.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  const index = items.findIndex((item) => item === document.activeElement)
  items[(index + direction + items.length) % items.length]?.focus()
}

function onViewportChange() {
  if (showScopeMenu.value) positionMenu()
}

watch(scopeDisabled, (disabled) => {
  if (disabled) closeScopeMenu()
})

useOutsideDismiss(
  showScopeMenu,
  () => closeScopeMenu(false),
  () => [runGroupRef.value, menuRef.value],
)

onMounted(() => {
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
})
</script>

<template>
  <div class="query-action-rail" role="group" :aria-label="t('database.query.actionRail')">
    <div ref="runGroupRef" class="run-group">
      <button
        v-if="loading && canCancel"
        type="button"
        class="ui-btn ui-btn-sm ui-btn-danger-solid run-stop"
        :disabled="cancelling"
        :aria-label="cancelLabel"
        :aria-busy="cancelling"
        :title="cancelling ? cancelLabel : t('database.query.cancelTitle')"
        @click="emit('cancel')"
      >
        <AppIcon name="stop" size="sm" />
      </button>
      <button
        v-else
        type="button"
        class="ui-btn ui-btn-sm ui-btn-primary run-main"
        :disabled="!scopeEnabled(defaultScope)"
        :aria-label="runLabel"
        :title="`${runLabel} · Ctrl+Enter`"
        @click="runDefault"
        @contextmenu.prevent="toggleScopeMenu"
      >
        <AppIcon name="play" size="sm" />
      </button>
      <button
        ref="scopeButton"
        type="button"
        class="run-scope"
        :disabled="scopeDisabled"
        :aria-label="t('database.query.runMenu')"
        :title="`${t('database.query.runMenu')} · ${runLabel}`"
        aria-haspopup="menu"
        :aria-expanded="showScopeMenu"
        @click="toggleScopeMenu"
      >
        {{ scopeLabel }}
      </button>
    </div>
    <span class="rail-divider" aria-hidden="true" />
    <button
      type="button"
      class="ui-icon-btn ui-icon-btn-sm"
      :disabled="!scopeEnabled(defaultScope)"
      :aria-label="t('database.query.plan')"
      :title="t('database.query.planTitle')"
      @click="emit('explain')"
    >
      <AppIcon name="query-plan" size="sm" />
    </button>
    <button
      type="button"
      class="ui-icon-btn ui-icon-btn-sm"
      :class="{ 'is-saved': isSaved }"
      :disabled="!hasSql"
      :aria-label="t('database.query.saveQuery')"
      :title="t('database.query.saveQueryTitle')"
      @click="emit('saveQuery')"
    >
      <AppIcon :name="isSaved ? 'star-fill' : 'star'" size="sm" />
    </button>
    <span v-if="readOnly" class="rail-ro" :title="t('database.query.readOnlyOn')">RO</span>
    <Teleport to="body">
      <div
        v-if="showScopeMenu"
        ref="menuRef"
        class="run-menu-portal"
        role="menu"
        :style="menuStyle"
        @click.stop
        @keydown.escape.stop.prevent="closeScopeMenu(true)"
        @keydown.down.prevent="moveScopeFocus(1)"
        @keydown.up.prevent="moveScopeFocus(-1)"
      >
        <button
          type="button"
          class="run-menu-item"
          role="menuitem"
          :disabled="!scopeEnabled('selection')"
          @click="runWith('selection')"
        >
          <span class="run-menu-label">{{ t('database.query.runSelection') }}</span>
          <span class="run-menu-desc">{{ t('database.query.runSelectionHint') }}</span>
        </button>
        <button
          type="button"
          class="run-menu-item"
          role="menuitem"
          :disabled="!scopeEnabled('statement')"
          @click="runWith('statement')"
        >
          <span class="run-menu-label">{{ t('database.query.runStatement') }}</span>
          <span class="run-menu-desc">{{ t('database.query.runStatementHint') }}</span>
        </button>
        <button
          type="button"
          class="run-menu-item"
          role="menuitem"
          :disabled="!scopeEnabled('all')"
          @click="runWith('all')"
        >
          <span class="run-menu-label">{{ t('database.query.runAll') }}</span>
          <span class="run-menu-desc">{{ t('database.query.runAllHint') }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.query-action-rail,
.run-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex-shrink: 0;
}

.query-action-rail {
  gap: 4px;
  box-sizing: border-box;
  width: calc(var(--icon-btn-sm) + 10px);
  padding: 6px 4px;
  overflow-y: auto;
  scrollbar-width: none;
  background: var(--bg-secondary);
  border-inline-end: 1px solid var(--border-color);
}

.run-group {
  gap: 2px;
}

.run-main,
.run-stop {
  width: var(--icon-btn-sm);
  height: var(--icon-btn-sm);
  padding: 0;
}

.run-scope {
  max-width: 100%;
  padding: 2px 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: var(--accent);
  font-size: 8px;
  font-weight: 700;
  white-space: nowrap;
  cursor: pointer;
}

.run-scope:hover:not(:disabled) {
  text-decoration: underline;
}

.run-scope:disabled {
  opacity: .45;
  cursor: default;
}

.rail-divider {
  flex: 0 0 1px;
  width: 22px;
  margin: 2px 0;
  background: var(--border-color);
}

.rail-ro {
  margin-top: 4px;
  padding: 1px 3px;
  border: 1px solid var(--warning);
  border-radius: 3px;
  color: var(--warning);
  font-size: 9px;
  font-weight: 800;
}

.is-saved {
  color: var(--warning);
}
</style>
