<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'
import type { RunScope } from '../../utils/sqlStatement'
import { isRunMenuItemEnabled } from '../../utils/queryUiController'
import './dbRunMenuPortal.css'

const { t } = useI18n()

const props = defineProps<{
  loading: boolean
  sessionAlive: boolean
  defaultScope: RunScope
  hasSelection: boolean
  canRunStatement: boolean
  readOnly: boolean
  isSaved: boolean
}>()

const emit = defineEmits<{
  run: [scope: RunScope]
  explain: []
  saveQuery: []
}>()

const runDisabled = computed(() => !props.sessionAlive || props.loading)

const showScopeMenu = ref(false)
const mainBtnRef = ref<HTMLButtonElement | null>(null)
const menuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<{ top: string; left: string; minWidth: string }>({
  top: '0px',
  left: '0px',
  minWidth: '180px',
})

/** Short scope label shown below the run button */
const scopeLabel = computed(() => {
  if (props.defaultScope === 'selection') return t('database.query.scopeLabelSelection')
  if (props.defaultScope === 'statement') return t('database.query.scopeLabelStatement')
  return t('database.query.scopeLabelAll')
})

/** Tooltip for the main run button, including the scope */
const runTooltip = computed(() => {
  const base = t('database.query.run')
  const scope = scopeLabel.value
  return `${base}（${scope}）· Ctrl+Enter`
})

function scopeEnabled(scope: RunScope) {
  if (props.loading) return false
  return isRunMenuItemEnabled(scope, {
    hasSelection: props.hasSelection,
    canRunStatement: props.canRunStatement,
    sessionAlive: props.sessionAlive,
  })
}

function runDefault() {
  if (runDisabled.value) return
  closeScopeMenu(false)
  emit('run', props.defaultScope)
}

function runWith(scope: RunScope) {
  if (!scopeEnabled(scope)) return
  closeScopeMenu(false)
  emit('run', scope)
}

function positionMenu() {
  const btn = mainBtnRef.value
  if (!btn) return
  const rect = btn.getBoundingClientRect()
  const menuW = 200
  const menuH = 160
  // Place to the right of the rail button
  let left = rect.right + 6
  let top = rect.top
  // Flip to left if would overflow viewport
  if (left + menuW > window.innerWidth - 8) {
    left = Math.max(8, rect.left - menuW - 6)
  }
  // Keep within viewport vertically
  if (top + menuH > window.innerHeight - 8) {
    top = Math.max(8, window.innerHeight - menuH - 8)
  }
  menuStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    minWidth: `${menuW}px`,
  }
}

function closeScopeMenu(refocus = false) {
  if (!showScopeMenu.value) return
  showScopeMenu.value = false
  if (refocus) void nextTick(() => mainBtnRef.value?.focus())
}

function onContextMenu(e: MouseEvent) {
  if (runDisabled.value) return
  e.preventDefault()
  showScopeMenu.value = !showScopeMenu.value
  if (showScopeMenu.value) {
    void nextTick(() => positionMenu())
  }
}

function onDocumentClick(e: MouseEvent) {
  if (!showScopeMenu.value) return
  const n = e.target as Node | null
  if (!n) return
  if (mainBtnRef.value?.contains(n)) return
  if (menuRef.value?.contains(n)) return
  closeScopeMenu(false)
}

function onDocumentKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showScopeMenu.value) {
    e.preventDefault()
    closeScopeMenu(true)
  }
}

function onViewportChange() {
  if (showScopeMenu.value) positionMenu()
}

onMounted(() => {
  document.addEventListener('click', onDocumentClick, true)
  document.addEventListener('keydown', onDocumentKeydown)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('scroll', onViewportChange, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocumentClick, true)
  document.removeEventListener('keydown', onDocumentKeydown)
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('scroll', onViewportChange, true)
})
</script>

<template>
  <div class="query-action-rail" role="toolbar" :aria-label="t('database.query.actionRail')">
      <!-- Single smart run button -->
      <div class="rail-run-group">
        <button
          ref="mainBtnRef"
          type="button"
          class="rail-btn primary"
          :disabled="runDisabled"
          :aria-label="runTooltip"
          :data-tooltip="runTooltip"
          @click="runDefault"
          @contextmenu="onContextMenu"
        >
          <AppIcon name="play" :size="16" />
        </button>
        <span
          class="rail-scope-label"
          :class="{ disabled: runDisabled }"
          :title="t('database.query.scopeLabelHint')"
        >{{ scopeLabel }}</span>
      </div>
      <span class="rail-divider" aria-hidden="true" />
      <button
        type="button"
        class="rail-btn"
        :disabled="runDisabled"
        :aria-label="t('database.query.plan')"
        :data-tooltip="t('database.query.planTitle')"
        @click="emit('explain')"
      >
        <AppIcon name="query-plan" :size="16" />
      </button>
      <button
        type="button"
        class="rail-btn"
        :class="{ active: isSaved }"
        :aria-label="t('database.query.saveQuery')"
        :data-tooltip="t('database.query.saveQueryTitle')"
        @click="emit('saveQuery')"
      >
        <AppIcon :name="isSaved ? 'star-fill' : 'star'" :size="16" />
      </button>
    <span v-if="readOnly" class="rail-ro" :title="t('database.query.readOnlyOn')">RO</span>

    <!-- Right-click scope selection menu (teleported to body) -->
    <Teleport to="body">
      <div
        v-if="showScopeMenu"
        ref="menuRef"
        class="run-menu-portal"
        role="menu"
        :style="menuStyle"
        @click.stop
        @keydown.escape.prevent="closeScopeMenu(true)"
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
.query-action-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 36px;
  flex-shrink: 0;
  padding: 6px 4px;
  overflow: visible;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  z-index: 20;
}

.rail-run-group {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.rail-scope-label {
  font-size: 8px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--accent);
  text-align: center;
  line-height: 1;
  white-space: nowrap;
  user-select: none;
  cursor: default;
}

.rail-scope-label.disabled {
  opacity: 0.45;
  color: var(--text-secondary);
}

.rail-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
}

.rail-btn::after {
  content: attr(data-tooltip);
  position: absolute;
  left: calc(100% + 8px);
  top: 50%;
  z-index: 10020;
  max-width: 300px;
  padding: 5px 8px;
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background: var(--bg-secondary);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  color: var(--text-primary);
  font-size: 11px;
  line-height: 1.3;
  white-space: nowrap;
  pointer-events: none;
  opacity: 0;
  transform: translateY(-50%) translateX(-2px);
  transition: opacity 100ms ease, transform 100ms ease;
}

.rail-btn:hover::after,
.rail-btn:focus-visible::after {
  opacity: 1;
  transform: translateY(-50%) translateX(0);
}

.rail-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
  background: var(--accent-bg);
}

.rail-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.rail-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.rail-btn.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
}

.rail-btn.active:not(:disabled) {
  color: #dd6b20;
  border-color: #dd6b20;
  background: color-mix(in srgb, #dd6b20 8%, transparent);
}

.rail-btn.active.primary {
  background: #dd6b20;
  border-color: #dd6b20;
  color: #fff;
}

.rail-btn.primary:hover:not(:disabled) {
  filter: brightness(1.08);
  color: #fff;
}

.rail-divider {
  width: 22px;
  height: 1px;
  margin: 2px 0;
  background: var(--border-color);
}

.rail-ro {
  margin-top: 4px;
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.04em;
  color: var(--warning, #d29922);
  border: 1px solid var(--warning, #d29922);
  border-radius: 3px;
  padding: 1px 3px;
}
</style>
