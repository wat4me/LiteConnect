<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
import SettingsAppResources from '@/components/settings/SettingsAppResources.vue'
import { placePopupNearAnchor } from '@/utils/shared/popupPosition'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'

const props = defineProps<{
  appMode: 'ssh' | 'database'
  showSettingsPage: boolean
}>()

const emit = defineEmits<{
  (e: 'enter-ssh', forceHome?: boolean): void
  (e: 'enter-database'): void
  (e: 'toggle-settings'): void
  (e: 'open-shortcuts'): void
}>()

const { t } = useI18n()
const menuOpen = ref(false)
const brandButtonRef = ref<HTMLButtonElement | null>(null)
const modeMenuRef = ref<HTMLElement | null>(null)
const menuStyle = ref<Record<string, string>>({ left: '0px', top: '0px' })
const resourceOpen = ref(false)
const resourceButtonRef = ref<HTMLButtonElement | null>(null)
const resourcePopupRef = ref<HTMLElement | null>(null)
const resourceStyle = ref<Record<string, string>>({ left: '0px', top: '0px' })

const moduleKey = computed(() => (props.appMode === 'database' ? 'DB' : 'SSH'))
const brandAria = computed(() =>
  props.appMode === 'database' ? t('app.brandDbAria') : t('app.brandSshAria'),
)

async function positionModeMenu() {
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  const btn = brandButtonRef.value
  const menu = modeMenuRef.value
  if (!btn || !menu) return
  const rect = btn.getBoundingClientRect()
  const size = { width: menu.offsetWidth || 108, height: menu.offsetHeight || 72 }
  const pos = placePopupNearAnchor(rect, size, { align: 'start', gap: 4 })
  menuStyle.value = { left: `${pos.left}px`, top: `${pos.top}px` }
}

function toggleMenu() {
  resourceOpen.value = false
  menuOpen.value = !menuOpen.value
}

function selectMode(mode: 'ssh' | 'database') {
  menuOpen.value = false
  if (mode === 'ssh') emit('enter-ssh')
  else emit('enter-database')
}

function closeMenu() {
  menuOpen.value = false
}

useOutsideDismiss(
  menuOpen,
  closeMenu,
  () => [brandButtonRef.value, modeMenuRef.value],
)

watch(menuOpen, (open) => {
  if (open) void positionModeMenu()
})

async function positionResourcePopup() {
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  const btn = resourceButtonRef.value
  const popup = resourcePopupRef.value
  if (!btn || !popup) return
  const rect = btn.getBoundingClientRect()
  const size = { width: popup.offsetWidth || 360, height: popup.offsetHeight || 320 }
  const pos = placePopupNearAnchor(rect, size, { align: 'end', gap: 6 })
  resourceStyle.value = {
    left: `${pos.left}px`,
    top: `${pos.top}px`,
    maxHeight: pos.maxHeight ? `${pos.maxHeight}px` : '72vh',
  }
}

function toggleResourcePopup() {
  menuOpen.value = false
  resourceOpen.value = !resourceOpen.value
}

function closeResourcePopup() {
  resourceOpen.value = false
}

useOutsideDismiss(
  resourceOpen,
  closeResourcePopup,
  () => [resourceButtonRef.value, resourcePopupRef.value],
)

watch(resourceOpen, (open) => {
  if (open) void positionResourcePopup()
})

watch(
  () => props.showSettingsPage,
  (open) => {
    if (open) resourceOpen.value = false
  },
)

watch(
  () => props.appMode,
  () => {
    resourceOpen.value = false
  },
)
</script>

<template>
  <!--
    系统标题栏（titleBarOverlay）：
    用 env(titlebar-area-*) 把内容限制在窗口控件左侧的安全区。
  -->
  <header class="app-titlebar">
    <div class="titlebar-safe">
      <div class="titlebar-left">
        <div class="titlebar-brand">
          <span class="titlebar-brand-lite">Lite</span>
          <button
            ref="brandButtonRef"
            type="button"
            class="titlebar-brand-module"
            data-onboarding="app-mode"
            :class="{ open: menuOpen }"
            :aria-label="brandAria"
            :aria-expanded="menuOpen"
            aria-haspopup="menu"
            @click="toggleMenu"
          >
            <span class="titlebar-brand-mod-text">{{ moduleKey }}</span>
            <AppIcon name="chevron-down" size="xs" class="titlebar-brand-chevron" />
          </button>

          <Teleport to="body">
            <div
              v-if="menuOpen"
              ref="modeMenuRef"
              class="titlebar-mode-menu"
              role="menu"
              :aria-label="t('app.modulesAria')"
              :style="menuStyle"
            >
              <button
                type="button"
                class="titlebar-mode-item"
                role="menuitemradio"
                :aria-checked="appMode === 'ssh'"
                @click="selectMode('ssh')"
              >
                <span class="titlebar-mode-check" aria-hidden="true"><AppIcon v-if="appMode === 'ssh'" name="check" size="xs" /></span>
                <span>SSH</span>
              </button>
              <button
                type="button"
                class="titlebar-mode-item"
                role="menuitemradio"
                :aria-checked="appMode === 'database'"
                @click="selectMode('database')"
              >
                <span class="titlebar-mode-check" aria-hidden="true"><AppIcon v-if="appMode === 'database'" name="check" size="xs" /></span>
                <span>DB</span>
              </button>
            </div>
          </Teleport>
        </div>
      </div>

      <div class="titlebar-right">
        <button
          type="button"
          class="titlebar-icon-btn"
          data-onboarding="shortcuts-help"
          :title="t('app.openShortcuts')"
          :aria-label="t('app.openShortcutsAria')"
          @click="closeResourcePopup(); emit('open-shortcuts')"
        >
          <AppIcon name="help-circle" size="sm" />
        </button>
        <button
          ref="resourceButtonRef"
          type="button"
          class="titlebar-icon-btn"
          :class="{ active: resourceOpen }"
          :aria-pressed="resourceOpen"
          :title="t('app.openResources')"
          :aria-label="t('app.openResourcesAria')"
          @click="toggleResourcePopup"
        >
          <AppIcon name="activity" size="sm" />
        </button>
        <button
          type="button"
          class="titlebar-icon-btn"
          :class="{ active: showSettingsPage }"
          :aria-pressed="showSettingsPage"
          :title="showSettingsPage ? t('app.closeSettings') : t('app.openSettings')"
          :aria-label="showSettingsPage ? t('app.closeSettings') : t('app.openSettings')"
          @click="emit('toggle-settings')"
        >
          <AppIcon name="settings" size="sm" />
        </button>
      </div>

      <Teleport to="body">
        <div
          v-if="resourceOpen"
          ref="resourcePopupRef"
          class="titlebar-resource-popup"
          role="dialog"
          aria-modal="false"
          :aria-label="t('about.resources')"
          :style="resourceStyle"
        >
          <div class="titlebar-resource-head">
            <span>{{ t('about.resources') }}</span>
            <button
              type="button"
              class="titlebar-resource-close"
              :title="t('common.close')"
              :aria-label="t('common.close')"
              @click="closeResourcePopup"
            >
              <AppIcon name="close" size="xs" />
            </button>
          </div>
          <SettingsAppResources @updated="positionResourcePopup" />
        </div>
      </Teleport>
    </div>
  </header>
</template>

<style scoped>
.app-titlebar {
  height: env(titlebar-area-height, 36px);
  min-height: env(titlebar-area-height, 36px);
  background: var(--bg-primary);
  border-bottom: none;
  flex-shrink: 0;
  -webkit-app-region: drag;
  user-select: none;
}

.titlebar-safe {
  box-sizing: border-box;
  height: 100%;
  margin-left: env(titlebar-area-x, 0px);
  width: env(titlebar-area-width, calc(100% - 148px));
  max-width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  position: relative;
}

.titlebar-left,
.titlebar-right {
  flex: 1;
  min-width: 0;
  height: 100%;
  display: flex;
  align-items: center;
  z-index: 2;
}

.titlebar-left {
  justify-content: flex-start;
  -webkit-app-region: drag;
}

.titlebar-right {
  /* Only the actual buttons should be no-drag. Let the empty middle area stay
     inside titlebar-left so it remains a native window drag target. */
  flex: 0 0 auto;
  justify-content: flex-end;
  gap: 4px;
  -webkit-app-region: no-drag;
}

.titlebar-brand {
  position: relative;
  display: inline-flex;
  align-items: baseline;
  height: 28px;
  padding: 0 2px 0 4px;
  margin: 0;
  color: var(--text-primary);
  flex-shrink: 0;
  -webkit-app-region: no-drag;
  line-height: 1;
}

.titlebar-brand-lite {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--text-primary);
  line-height: 28px;
}

.titlebar-brand-module {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  height: 22px;
  margin: 0 0 0 0;
  padding: 0 4px 0 1px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--success);
  font: inherit;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  line-height: 1;
}

.titlebar-brand-mod-text {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1;
}

.titlebar-brand-chevron {
  flex-shrink: 0;
  opacity: 0.75;
  margin-top: 1px;
}

.titlebar-brand-module:hover,
.titlebar-brand-module.open {
  background: color-mix(in srgb, var(--success) 12%, transparent);
}

.titlebar-brand-module:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.titlebar-mode-menu {
  position: fixed;
  min-width: 108px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  z-index: 12000;
  -webkit-app-region: no-drag;
}

.titlebar-mode-item {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
}

.titlebar-mode-item:hover {
  background: var(--hover-bg);
}

.titlebar-mode-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -1px;
}

.titlebar-mode-check {
  width: 12px;
  flex-shrink: 0;
  font-size: 11px;
  color: var(--success);
  text-align: center;
}

.titlebar-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 0;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.12s, color 0.12s;
}

.titlebar-icon-btn:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}

.titlebar-icon-btn.active {
  color: var(--accent);
  background: var(--accent-bg);
}

.titlebar-icon-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.titlebar-resource-popup {
  position: fixed;
  width: 380px;
  max-width: calc(100vw - 16px);
  overflow: auto;
  padding: 0 16px 16px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
  z-index: 12000;
  -webkit-app-region: no-drag;
}

.titlebar-resource-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 40px;
  margin: 0 -16px 12px;
  padding: 0 8px 0 16px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.titlebar-resource-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.titlebar-resource-close:hover {
  background: var(--hover-bg);
  color: var(--text-primary);
}
</style>
