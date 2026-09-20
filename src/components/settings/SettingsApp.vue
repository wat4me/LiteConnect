<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { SettingsDraft } from '@/composables/settings/useSettingsDraft'
import { DEFAULT_GLOBAL_HOTKEY, keyEventToAccelerator } from '@shared/globalHotkey'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{
  draft: SettingsDraft
}>()

const { t } = useI18n()

const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)

/** Capture mode: the next keydown with a modifier becomes the new accelerator. */
const capturing = ref(false)
/** Briefly flag a combo that Electron cannot register (no modifier). */
const invalid = ref(false)

const MODIFIER_ONLY_KEYS = ['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock']

function stopCapture(): void {
  capturing.value = false
  window.removeEventListener('keydown', onCaptureKeydown, true)
  window.removeEventListener('blur', stopCapture)
}

function onCaptureKeydown(e: KeyboardEvent): void {
  // Swallow the key so app-level shortcut handlers never see it mid-capture
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') {
    stopCapture()
    return
  }
  if (MODIFIER_ONLY_KEYS.includes(e.key)) return // keep waiting for the main key
  const accelerator = keyEventToAccelerator(e, navigator.platform)
  if (!accelerator) {
    invalid.value = true
    return
  }
  invalid.value = false
  props.draft.globalHotkey = accelerator
  stopCapture()
}

function toggleCapture(): void {
  if (capturing.value) {
    stopCapture()
    return
  }
  capturing.value = true
  invalid.value = false
  window.addEventListener('keydown', onCaptureKeydown, true)
  window.addEventListener('blur', stopCapture)
}

function resetHotkey(): void {
  props.draft.globalHotkey = DEFAULT_GLOBAL_HOTKEY
  ElMessage.success(t('settingsApp.globalHotkeyResetDone', { accel: DEFAULT_GLOBAL_HOTKEY }))
}

let stopFailureListener: (() => void) | undefined
onMounted(() => {
  stopFailureListener = window.LiteConnect.onGlobalHotkeyFailed((accelerator) => {
    ElMessage.warning(t('settingsApp.globalHotkeyConflict', { accel: accelerator }))
  })
})
onBeforeUnmount(() => {
  stopFailureListener?.()
  stopCapture()
})
</script>

<template>
  <section class="settings-content" data-setting="app">
    <header class="content-header">
      <h3>{{ t('settingsApp.title') }}</h3>
      <p>{{ t('settingsApp.intro') }}</p>
    </header>

    <div class="settings-card narrow">
      <div class="settings-label">{{ t('settingsApp.window') }}</div>

      <div class="settings-option" data-setting="app.closeToTray">
        <div class="settings-option-copy">
          <span class="settings-option-title">{{ t('settingsApp.closeToTray') }}</span>
          <p class="settings-hint">{{ t('settingsApp.closeToTrayHint') }}</p>
        </div>
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: draft.closeToTrayEnabled }"
          :aria-pressed="draft.closeToTrayEnabled"
          @click="draft.closeToTrayEnabled = !draft.closeToTrayEnabled"
        >
          <span class="toggle-knob"></span>
        </button>
      </div>

      <div class="settings-option settings-option-block" data-setting="app.globalHotkey">
        <div class="settings-option-head">
          <div class="settings-option-copy">
            <span class="settings-option-title">{{ t('settingsApp.globalHotkey') }}</span>
            <p class="settings-hint">{{ t('settingsApp.globalHotkeyHint') }}</p>
          </div>
          <button
            type="button"
            class="toggle-btn"
            :class="{ active: draft.globalHotkeyEnabled }"
            :aria-pressed="draft.globalHotkeyEnabled"
            @click="draft.globalHotkeyEnabled = !draft.globalHotkeyEnabled"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>
        <div class="hotkey-row" data-setting="app.globalHotkeyValue">
          <span class="hotkey-row-label">{{ t('settingsApp.globalHotkeyCurrent') }}</span>
          <div class="hotkey-controls">
            <button
              type="button"
              class="hotkey-capture"
              :class="{ 'is-capturing': capturing, 'is-invalid': invalid }"
              :title="t('settingsApp.globalHotkeyCaptureTitle')"
              :aria-label="t('settingsApp.globalHotkeyCaptureTitle')"
              @click="toggleCapture"
            >
              <AppIcon name="key" size="xs" />
              <span v-if="capturing">{{ t('settingsApp.globalHotkeyCapturing') }}</span>
              <span v-else class="hotkey-value">{{ draft.globalHotkey }}</span>
            </button>
            <button
              v-if="draft.globalHotkey !== DEFAULT_GLOBAL_HOTKEY"
              type="button"
              class="ui-btn ui-btn-sm"
              @click="resetHotkey"
            >
              {{ t('settingsApp.globalHotkeyReset') }}
            </button>
          </div>
        </div>
        <p v-if="invalid" class="settings-hint hotkey-invalid-hint">
          {{ t('settingsApp.globalHotkeyInvalid') }}
        </p>
      </div>

      <div class="settings-option" data-setting="app.workspaceRestore">
        <div class="settings-option-copy">
          <span class="settings-option-title">{{ t('settingsApp.workspaceRestore') }}</span>
          <p class="settings-hint">{{ t('settingsApp.workspaceRestoreHint') }}</p>
        </div>
        <button
          type="button"
          class="toggle-btn"
          :class="{ active: draft.workspaceRestoreEnabled }"
          :aria-pressed="draft.workspaceRestoreEnabled"
          @click="draft.workspaceRestoreEnabled = !draft.workspaceRestoreEnabled"
        >
          <span class="toggle-knob"></span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.settings-option.settings-option-block {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}

.settings-option-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
}

.hotkey-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.hotkey-row-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
}

.hotkey-controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.hotkey-capture {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 168px;
  padding: 6px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm, 6px);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
  justify-content: center;
}

.hotkey-capture:hover {
  border-color: var(--accent);
}

.hotkey-capture.is-capturing {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-bg);
}

.hotkey-capture.is-invalid {
  border-color: var(--danger);
}

.hotkey-value {
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  letter-spacing: 0.02em;
}

.hotkey-invalid-hint {
  margin: 0;
}
</style>
