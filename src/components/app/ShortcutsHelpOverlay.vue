<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { KEYBOARD_SHORTCUTS } from '@/composables/app/useTheme'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()
const panelRef = ref<HTMLElement | null>(null)

const shortcuts = computed(() =>
  KEYBOARD_SHORTCUTS.map((item) => ({
    keys: item.keysKey ? t(item.keysKey) : item.keys,
    desc: t(item.descKey),
    scope: t(item.scopeKey),
  })),
)

useOutsideDismiss(
  () => props.visible,
  () => emit('close'),
  () => [panelRef.value],
)

watch(
  () => props.visible,
  (open) => {
    if (open) {
      // Focus panel for accessibility
      requestAnimationFrame(() => panelRef.value?.focus())
    }
  },
)
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="shortcuts-overlay" role="presentation">
      <div
        ref="panelRef"
        class="shortcuts-panel"
        role="dialog"
        :aria-label="t('settingsShortcuts.title')"
        tabindex="-1"
      >
        <div class="shortcuts-header">
          <div>
            <h3 class="shortcuts-title">{{ t('settingsShortcuts.title') }}</h3>
            <p class="shortcuts-intro">{{ t('settingsShortcuts.overlayIntro') }}</p>
          </div>
          <button
            type="button"
            class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close"
            :title="t('common.close')"
            :aria-label="t('common.close')"
            @click="emit('close')"
          >
            <AppIcon name="close" size="sm" />
          </button>
        </div>
        <div class="shortcuts-list">
          <div v-for="item in shortcuts" :key="item.keys + item.desc" class="shortcut-row">
            <kbd class="shortcut-keys">{{ item.keys }}</kbd>
            <div class="shortcut-meta">
              <div class="shortcut-desc">{{ item.desc }}</div>
              <div class="shortcut-scope">{{ item.scope }}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.shortcuts-overlay {
  position: fixed;
  inset: 0;
  z-index: 13000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(0, 0, 0, 0.45);
}

.shortcuts-panel {
  width: min(480px, 100%);
  max-height: min(72vh, 640px);
  display: flex;
  flex-direction: column;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.35);
  outline: none;
}

.shortcuts-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 14px 10px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.shortcuts-title {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
}

.shortcuts-intro {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary);
}

.shortcuts-list {
  min-height: 0;
  overflow-y: auto;
  padding: 4px 10px 10px;
}

.shortcut-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 4px;
  border-bottom: 1px solid var(--border-color);
}

.shortcut-row:last-child {
  border-bottom: none;
}

.shortcut-keys {
  flex-shrink: 0;
  min-width: 108px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  color: var(--text-primary);
  text-align: center;
}

.shortcut-meta {
  min-width: 0;
}

.shortcut-desc {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}

.shortcut-scope {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary);
}
</style>
