<script setup lang="ts">
import { nextTick, watch, ref } from 'vue'
import {
  appDialogCancel,
  appDialogConfirm,
  useAppDialogMutable,
} from '../composables/useAppDialog'

const state = useAppDialogMutable()
const inputRef = ref<HTMLInputElement | null>(null)
const confirmRef = ref<HTMLButtonElement | null>(null)

watch(
  () => state.visible,
  async (v) => {
    if (!v) return
    await nextTick()
    if (state.mode === 'prompt') {
      inputRef.value?.focus()
      inputRef.value?.select()
    } else {
      // Keep keyboard events inside the teleported dialog so Enter/Escape work
      // even when the opener was a canvas/terminal element.
      confirmRef.value?.focus()
    }
  },
)

function onKeydown(e: KeyboardEvent) {
  if (!state.visible) return
  if (e.key === 'Escape') {
    e.preventDefault()
    appDialogCancel()
  } else if (e.key === 'Enter' && state.mode === 'confirm') {
    e.preventDefault()
    appDialogConfirm()
  }
}

function onInputKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    appDialogConfirm()
  }
}

function onInput() {
  if (state.inputError) state.inputError = ''
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="state.visible"
      class="ui-modal-overlay app-dialog-overlay"
      role="dialog"
      aria-modal="true"
      :aria-labelledby="'app-dialog-title'"
      @keydown="onKeydown"
      @click.self="appDialogCancel"
    >
      <div class="ui-modal-card app-dialog" :class="[`tone-${state.tone}`]">
        <div class="app-dialog-header">
          <span
            class="app-dialog-icon"
            :class="state.tone"
            aria-hidden="true"
          >
            <!-- warning -->
            <svg v-if="state.tone === 'warning'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
              <line x1="12" y1="9" x2="12" y2="13"/>
              <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <!-- danger -->
            <svg v-else-if="state.tone === 'danger'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
            <!-- info -->
            <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
          </span>
          <h3 id="app-dialog-title" class="app-dialog-title">{{ state.title }}</h3>
        </div>

        <div class="app-dialog-body">
          <p v-if="state.message" class="app-dialog-message">{{ state.message }}</p>
          <pre v-if="state.detail" class="app-dialog-detail">{{ state.detail }}</pre>

          <div v-if="state.mode === 'prompt'" class="app-dialog-field">
            <input
              ref="inputRef"
              v-model="state.inputValue"
              class="ui-input"
              :type="state.inputType"
              :placeholder="state.inputPlaceholder"
              :maxlength="state.maxLength"
              @input="onInput"
              @keydown="onInputKeydown"
            />
            <p v-if="state.inputError" class="app-dialog-error">{{ state.inputError }}</p>
          </div>
        </div>

        <div class="app-dialog-actions">
          <button type="button" class="ui-btn" @click="appDialogCancel">
            {{ state.cancelText }}
          </button>
          <button
            ref="confirmRef"
            type="button"
            class="ui-btn"
            :class="state.danger ? 'ui-btn-danger-solid' : 'ui-btn-primary'"
            @click="appDialogConfirm"
          >
            {{ state.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.app-dialog-overlay {
  z-index: 11000;
}

.app-dialog {
  width: min(520px, calc(100vw - 32px));
  max-height: calc(100vh - 48px);
  padding: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
}

.app-dialog-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.app-dialog-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.app-dialog-icon.warning {
  color: var(--warning);
  background: color-mix(in srgb, var(--warning) 14%, transparent);
}

.app-dialog-icon.danger {
  color: var(--danger);
  background: color-mix(in srgb, var(--danger) 14%, transparent);
}

.app-dialog-icon.info {
  color: var(--accent);
  background: var(--accent-bg);
}

.app-dialog-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.3;
}

.app-dialog-body {
  padding: 16px 20px;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
}

.app-dialog-message {
  margin: 0;
  font-size: 13px;
  color: var(--text-primary);
  line-height: 1.55;
  white-space: pre-wrap;
  flex-shrink: 0;
}

.app-dialog-detail {
  margin: 0;
  padding: 10px 12px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  color: var(--text-secondary);
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  overflow: auto;
  max-height: min(40vh, 320px);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-secondary, color-mix(in srgb, var(--text-primary) 4%, transparent));
}

.app-dialog-field {
  margin-top: 2px;
  flex-shrink: 0;
}

.app-dialog-error {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--danger);
}

.app-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 20px 18px;
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.app-dialog-actions .ui-btn {
  min-width: 88px;
}
</style>
