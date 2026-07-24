<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from './icons/AppIcon.vue'

const props = defineProps<{
  appMode: 'ssh' | 'database'
  showSettingsPage: boolean
  connectionLabel: string
}>()

const emit = defineEmits<{
  (e: 'enter-ssh', forceHome?: boolean): void
  (e: 'enter-database'): void
  (e: 'toggle-settings'): void
}>()

const { t } = useI18n()
const menuOpen = ref(false)
const brandRootRef = ref<HTMLElement | null>(null)

const moduleKey = computed(() => (props.appMode === 'database' ? 'DB' : 'SSH'))
const brandAria = computed(() =>
  props.appMode === 'database' ? t('app.brandDbAria') : t('app.brandSshAria'),
)

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}

function selectMode(mode: 'ssh' | 'database') {
  menuOpen.value = false
  if (mode === 'ssh') emit('enter-ssh')
  else emit('enter-database')
}

function onDocPointerDown(e: PointerEvent) {
  if (!menuOpen.value) return
  const root = brandRootRef.value
  if (root && e.target instanceof Node && root.contains(e.target)) return
  menuOpen.value = false
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && menuOpen.value) {
    menuOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <!--
    系统标题栏（titleBarOverlay）：
    用 env(titlebar-area-*) 把内容限制在窗口控件左侧的安全区。
  -->
  <header class="app-titlebar">
    <div class="titlebar-safe">
      <div class="titlebar-left">
        <div ref="brandRootRef" class="titlebar-brand">
          <span class="titlebar-brand-lite">Lite</span>
          <button
            type="button"
            class="titlebar-brand-module"
            :class="{ open: menuOpen }"
            :aria-label="brandAria"
            :aria-expanded="menuOpen"
            aria-haspopup="menu"
            @click="toggleMenu"
          >
            <span class="titlebar-brand-mod-text">{{ moduleKey }}</span>
            <AppIcon name="chevron-down" :size="10" class="titlebar-brand-chevron" />
          </button>

          <div
            v-if="menuOpen"
            class="titlebar-mode-menu"
            role="menu"
            :aria-label="t('app.modulesAria')"
          >
            <button
              type="button"
              class="titlebar-mode-item"
              role="menuitemradio"
              :aria-checked="appMode === 'ssh'"
              @click="selectMode('ssh')"
            >
              <span class="titlebar-mode-check" aria-hidden="true">{{ appMode === 'ssh' ? '✓' : '' }}</span>
              <span>SSH</span>
            </button>
            <button
              type="button"
              class="titlebar-mode-item"
              role="menuitemradio"
              :aria-checked="appMode === 'database'"
              @click="selectMode('database')"
            >
              <span class="titlebar-mode-check" aria-hidden="true">{{ appMode === 'database' ? '✓' : '' }}</span>
              <span>DB</span>
            </button>
          </div>
        </div>
      </div>

      <div class="titlebar-center">
        <span class="titlebar-conn" :title="connectionLabel">{{ connectionLabel }}</span>
      </div>

      <div class="titlebar-right">
        <button
          type="button"
          class="titlebar-icon-btn"
          :class="{ active: showSettingsPage }"
          :aria-pressed="showSettingsPage"
          :title="showSettingsPage ? t('app.closeSettings') : t('app.openSettings')"
          :aria-label="showSettingsPage ? t('app.closeSettings') : t('app.openSettings')"
          @click="emit('toggle-settings')"
        >
          <AppIcon name="settings" :size="14" />
        </button>
      </div>
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
  justify-content: flex-end;
  gap: 4px;
}

.titlebar-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  max-width: min(46%, 420px);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 1;
}

.titlebar-conn {
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 500;
  line-height: 1.2;
  color: var(--text-secondary);
  letter-spacing: 0.01em;
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
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  min-width: 108px;
  padding: 4px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  z-index: 50;
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
  border-radius: 7px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.12s, color 0.12s;
}

.titlebar-icon-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.titlebar-icon-btn.active {
  color: var(--accent);
  background: var(--accent-bg, color-mix(in srgb, var(--accent) 16%, transparent));
}

.titlebar-icon-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}
</style>
