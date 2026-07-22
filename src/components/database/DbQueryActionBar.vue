<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'
import type { RunScope } from '../../utils/sqlStatement'
import { isRunMenuItemEnabled } from '../../utils/queryUiController'
/** Shared teleported menu styles (same module as active rail; no local copy). */
import './dbRunMenuPortal.css'

const { t } = useI18n()

const props = defineProps<{
  loading: boolean
  cancelling: boolean
  sessionAlive: boolean
  defaultScope: RunScope
  hasSelection: boolean
  canRunStatement: boolean
  fallbackHint?: string
}>()

const emit = defineEmits<{
  run: [scope: RunScope]
  explain: []
  cancel: []
}>()

const showRunMenu = ref(false)
const runCaretRef = ref<HTMLButtonElement | null>(null)
const runMenuRef = ref<HTMLElement | null>(null)
/** Fixed-position menu coords so ancestors with overflow cannot clip it */
const menuStyle = ref<{ top: string; left: string; minWidth: string }>({
  top: '0px',
  left: '0px',
  minWidth: '180px',
})

const primaryLabel = computed(() => {
  if (props.defaultScope === 'selection') return t('database.query.runSelection')
  if (props.defaultScope === 'statement') return t('database.query.runStatement')
  return t('database.query.runAll')
})

const runDisabled = computed(() => !props.sessionAlive)
const explainDisabled = computed(() => !props.sessionAlive)

function menuEnabled(scope: RunScope) {
  return isRunMenuItemEnabled(scope, {
    hasSelection: props.hasSelection,
    canRunStatement: props.canRunStatement,
    sessionAlive: props.sessionAlive,
  })
}

function positionMenu() {
  const btn = runCaretRef.value
  if (!btn) return
  const rect = btn.getBoundingClientRect()
  const primaryW = (btn.previousElementSibling as HTMLElement | null)?.offsetWidth ?? 0
  const minWidth = Math.max(180, rect.width + primaryW)
  // Prefer below the split button; flip above if near viewport bottom
  const menuHeight = 140
  const spaceBelow = window.innerHeight - rect.bottom
  const top =
    spaceBelow < menuHeight && rect.top > menuHeight
      ? Math.max(8, rect.top - menuHeight - 4)
      : rect.bottom + 4
  // Align menu right edge with caret right edge
  const width = minWidth
  let left = rect.right - width
  left = Math.max(8, Math.min(left, window.innerWidth - width - 8))
  menuStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    minWidth: `${Math.round(width)}px`,
  }
}

function closeMenu(refocus = false) {
  if (!showRunMenu.value) return
  showRunMenu.value = false
  if (refocus) {
    void nextTick(() => runCaretRef.value?.focus())
  }
}

function onDocumentClick(e: MouseEvent) {
  if (!showRunMenu.value) return
  const t = e.target as Node | null
  if (!t) return
  if (runCaretRef.value?.contains(t)) return
  if (runMenuRef.value?.contains(t)) return
  closeMenu(false)
}

function onDocumentKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && showRunMenu.value) {
    e.preventDefault()
    closeMenu(true)
  }
}

function onViewportChange() {
  if (showRunMenu.value) positionMenu()
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

watch(showRunMenu, (open) => {
  if (open) {
    void nextTick(() => positionMenu())
  }
})

function runDefault() {
  closeMenu(false)
  emit('run', props.defaultScope)
}

function runWith(scope: RunScope) {
  if (!menuEnabled(scope)) return
  closeMenu(false)
  emit('run', scope)
  void nextTick(() => runCaretRef.value?.focus())
}

function toggleMenu() {
  if (runDisabled.value) return
  showRunMenu.value = !showRunMenu.value
  if (showRunMenu.value) {
    void nextTick(() => positionMenu())
  }
}
</script>

<template>
  <div class="query-action-bar">
    <span class="query-hotkey" :title="fallbackHint || t('database.query.hotkeyHint')">
      {{ fallbackHint || t('database.query.hotkeyHint') }}
    </span>
    <div class="query-toolbar-spacer" />
    <template v-if="loading">
      <button
        type="button"
        class="ui-btn ui-btn-sm ui-btn-danger-solid run-btn"
        :disabled="!!cancelling"
        :title="t('database.query.cancelTitle')"
        :aria-busy="!!cancelling"
        @click="emit('cancel')"
      >
        <AppIcon name="stop" :size="12" />
        {{ cancelling ? t('database.query.cancelling') : t('database.query.cancel') }}
      </button>
    </template>
    <template v-else>
      <button
        type="button"
        class="ui-btn ui-btn-sm"
        :disabled="explainDisabled"
        :title="t('database.query.planTitle')"
        @click="emit('explain')"
      >
        {{ t('database.query.plan') }}
      </button>
      <div class="run-split">
        <button
          type="button"
          class="ui-btn ui-btn-sm ui-btn-primary run-btn"
          :disabled="runDisabled"
          @click="runDefault"
        >
          <AppIcon name="play" :size="12" /> {{ primaryLabel }}
        </button>
        <button
          ref="runCaretRef"
          type="button"
          class="ui-btn ui-btn-sm ui-btn-primary run-caret"
          :disabled="runDisabled"
          :title="t('database.query.runMenu')"
          :aria-expanded="showRunMenu"
          aria-haspopup="menu"
          @click.stop="toggleMenu"
        >
          ▾
        </button>
      </div>
      <!-- Teleport to body + fixed coords: never clipped by toolbar overflow -->
      <Teleport to="body">
        <div
          v-if="showRunMenu"
          ref="runMenuRef"
          class="run-menu-portal"
          role="menu"
          :style="menuStyle"
          @click.stop
          @keydown.escape.prevent="closeMenu(true)"
        >
          <button
            type="button"
            class="run-menu-item"
            role="menuitem"
            :disabled="!menuEnabled('selection')"
            :title="
              hasSelection
                ? t('database.query.runSelectionHint')
                : t('database.query.needSelection')
            "
            @click="runWith('selection')"
          >
            <span class="run-menu-label">{{ t('database.query.runSelection') }}</span>
            <span class="run-menu-desc">{{ t('database.query.runSelectionHint') }}</span>
          </button>
          <button
            type="button"
            class="run-menu-item"
            role="menuitem"
            :disabled="!menuEnabled('statement')"
            :title="
              canRunStatement
                ? t('database.query.runStatementHint')
                : t('database.query.statementAmbiguous')
            "
            @click="runWith('statement')"
          >
            <span class="run-menu-label">{{ t('database.query.runStatement') }}</span>
            <span class="run-menu-desc">{{ t('database.query.runStatementHint') }}</span>
          </button>
          <button
            type="button"
            class="run-menu-item"
            role="menuitem"
            :disabled="!menuEnabled('all')"
            :title="t('database.query.runAllHint')"
            @click="runWith('all')"
          >
            <span class="run-menu-label">{{ t('database.query.runAll') }}</span>
            <span class="run-menu-desc">{{ t('database.query.runAllHint') }}</span>
          </button>
        </div>
      </Teleport>
    </template>
  </div>
</template>

<style scoped>
.query-action-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
  flex-wrap: wrap;
  min-width: 0;
  /* Do not clip descendants; menu itself is teleported */
  overflow: visible;
}

.query-toolbar-spacer {
  flex: 1;
  min-width: 8px;
}

.query-hotkey {
  font-size: 11px;
  color: var(--text-secondary);
  flex-shrink: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-btn {
  flex-shrink: 0;
  min-width: 72px;
}

.run-split {
  position: relative;
  display: inline-flex;
  align-items: stretch;
  flex-shrink: 0;
}

.run-split .run-btn {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.run-caret {
  min-width: 28px;
  padding-left: 4px;
  padding-right: 6px;
  border-top-left-radius: 0;
  border-bottom-left-radius: 0;
  border-left: 1px solid color-mix(in srgb, #fff 25%, transparent);
  margin-left: -1px;
}
</style>
