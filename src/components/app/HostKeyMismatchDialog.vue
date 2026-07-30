<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { HostKeyMismatchData } from '@/composables/app/useSecurityDialogs'
import {
  formatFingerprintForCopy,
  groupFingerprintBody,
  parseFingerprint,
} from '@/utils/connections/fingerprintDisplay'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps<{
  data: HostKeyMismatchData | null
}>()

const emit = defineEmits<{
  (e: 'accept'): void
  (e: 'reject'): void
}>()

const { t } = useI18n()
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | null = null

const isUnknown = computed(() => !props.data?.existingFingerprint)
const isJump = computed(() => props.data?.role === 'jump')
const isMismatch = computed(() => !!props.data?.existingFingerprint)

const titleText = computed(() => {
  if (isUnknown.value) {
    return isJump.value ? t('dialog.hostKeyTitleFirstJump') : t('dialog.hostKeyTitleFirst')
  }
  return isJump.value ? t('dialog.hostKeyTitleMismatchJump') : t('dialog.hostKeyTitleMismatch')
})

const warningText = computed(() => {
  const d = props.data
  if (!d) return ''
  if (isUnknown.value && isJump.value) {
    return t('dialog.hostKeyWarningUnknownJump', { host: d.host, port: d.port })
  }
  if (isUnknown.value) {
    return t('dialog.hostKeyWarningUnknown', { host: d.host, port: d.port })
  }
  if (isJump.value) {
    return t('dialog.hostKeyWarningJump', { host: d.host, port: d.port })
  }
  return t('dialog.hostKeyWarning', { host: d.host, port: d.port })
})

const noteText = computed(() => {
  if (isUnknown.value) return t('dialog.hostKeyNoteFirst')
  return t('dialog.hostKeyNoteMismatch')
})

const hostLabel = computed(() => {
  const d = props.data
  if (!d) return ''
  return `${d.host}:${d.port}`
})

const newFp = computed(() => parseFingerprint(props.data?.newFingerprint))
const oldFp = computed(() => parseFingerprint(props.data?.existingFingerprint))
const newGroups = computed(() => groupFingerprintBody(newFp.value.body))
const oldGroups = computed(() => groupFingerprintBody(oldFp.value.body))

async function copyFingerprint() {
  const text = formatFingerprintForCopy(props.data?.newFingerprint)
  if (!text) return
  try {
    await window.LiteConnect.clipboardWriteText(text)
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
      copyTimer = null
    }, 1600)
  } catch {
    ElMessage.warning(t('common.copyFailed'))
  }
}
</script>

<template>
  <div
    class="ui-modal-overlay host-key-dialog-overlay"
    role="dialog"
    aria-modal="true"
    aria-labelledby="host-key-title"
    @click.self="emit('reject')"
  >
    <div
      class="ui-modal-card host-key-dialog"
      :class="{ 'is-first': isUnknown, 'is-mismatch': isMismatch }"
    >
      <div class="dialog-header">
        <AppIcon
          :name="isUnknown ? 'info' : 'alert-triangle'"
          size="2xl"
          class="dialog-tone-icon"
          :class="isUnknown ? 'info' : 'warning'"
        />
        <div class="dialog-header-text">
          <span id="host-key-title" class="dialog-title">{{ titleText }}</span>
          <span v-if="hostLabel" class="dialog-host">{{ hostLabel }}</span>
        </div>
      </div>

      <div class="dialog-body">
        <p class="dialog-warning">{{ warningText }}</p>
        <p class="dialog-note">{{ noteText }}</p>

        <ol v-if="isUnknown" class="trust-steps">
          <li>{{ t('dialog.hostKeyStep1') }}</li>
          <li>{{ t('dialog.hostKeyStep2') }}</li>
          <li>{{ t('dialog.hostKeyStep3') }}</li>
        </ol>

        <div v-if="isMismatch" class="fingerprint-block old">
          <div class="fingerprint-block-head">
            <span class="fingerprint-label">{{ t('dialog.fingerprintOld') }}</span>
            <span class="fingerprint-algo">{{ oldFp.algorithm }}</span>
          </div>
          <div class="fingerprint-large old" aria-label="old fingerprint">
            <span v-for="(g, i) in oldGroups" :key="'o' + i" class="fp-group">{{ g }}</span>
          </div>
        </div>

        <div class="fingerprint-block new">
          <div class="fingerprint-block-head">
            <span class="fingerprint-label">{{
              isMismatch ? t('dialog.fingerprintNew') : t('dialog.fingerprintCurrent')
            }}</span>
            <span class="fingerprint-algo">{{ newFp.algorithm }}</span>
            <button
              type="button"
              class="copy-fp-btn"
              :title="t('dialog.copyFingerprint')"
              @click="copyFingerprint"
            >
              <AppIcon :name="copied ? 'check' : 'copy'" size="xs" />
              {{ copied ? t('common.copied') : t('dialog.copyFingerprint') }}
            </button>
          </div>
          <div class="fingerprint-large new" aria-label="host key fingerprint">
            <span v-for="(g, i) in newGroups" :key="'n' + i" class="fp-group">{{ g }}</span>
          </div>
          <p class="fingerprint-hint">{{ t('dialog.fingerprintHint') }}</p>
        </div>
      </div>

      <div class="dialog-actions">
        <button type="button" class="ui-btn dialog-btn" @click="emit('reject')">
          {{ t('dialog.rejectConnect') }}
        </button>
        <button
          type="button"
          class="ui-btn ui-btn-primary dialog-btn"
          :class="{ danger: isMismatch }"
          @click="emit('accept')"
        >
          {{ isUnknown ? t('dialog.trustAndConnect') : t('dialog.trustChangedKey') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.host-key-dialog-overlay {
  z-index: 10000;
}

.host-key-dialog {
  width: 520px;
  max-width: 94vw;
  padding: 0;
  background: var(--bg-primary);
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 20px 24px 16px;
  border-bottom: 1px solid var(--border-color);
}

.dialog-header-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  line-height: 1.35;
}

.dialog-host {
  font-size: 12px;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  color: var(--text-secondary);
  word-break: break-all;
}

.dialog-tone-icon.warning {
  color: var(--warning);
  flex-shrink: 0;
}

.dialog-tone-icon.info {
  color: var(--accent, #3b82f6);
  flex-shrink: 0;
}

.dialog-body {
  padding: 16px 24px;
}

.dialog-warning {
  font-size: 14px;
  color: var(--text-primary);
  margin: 0 0 8px;
  line-height: 1.55;
}

.dialog-note {
  font-size: 12.5px;
  color: var(--text-secondary);
  margin: 0 0 14px;
  line-height: 1.5;
}

.trust-steps {
  margin: 0 0 16px;
  padding: 10px 12px 10px 28px;
  background: color-mix(in srgb, var(--accent, #3b82f6) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent, #3b82f6) 18%, transparent);
  border-radius: 8px;
  font-size: 12.5px;
  color: var(--text-primary);
  line-height: 1.55;
}

.trust-steps li + li {
  margin-top: 4px;
}

.fingerprint-block {
  margin-bottom: 12px;
  border-radius: 10px;
  padding: 12px 14px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary, color-mix(in srgb, var(--text-primary) 4%, transparent));
}

.fingerprint-block.new {
  background: color-mix(in srgb, var(--success) 8%, transparent);
  border-color: color-mix(in srgb, var(--success) 28%, transparent);
}

.fingerprint-block.old {
  background: color-mix(in srgb, var(--danger) 8%, transparent);
  border-color: color-mix(in srgb, var(--danger) 28%, transparent);
}

.fingerprint-block-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.fingerprint-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.fingerprint-algo {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text-primary) 8%, transparent);
  color: var(--text-primary);
}

.copy-fp-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}

.copy-fp-btn:hover {
  color: var(--text-primary);
  background: color-mix(in srgb, var(--text-primary) 8%, transparent);
}

.fingerprint-large {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 8px;
  font-family: 'Cascadia Code', 'Fira Code', Consolas, monospace;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1.45;
  word-break: break-all;
  user-select: all;
}

.fingerprint-large.new {
  color: var(--success);
}

.fingerprint-large.old {
  color: var(--danger);
  text-decoration: line-through;
  opacity: 0.9;
  font-size: 13px;
  font-weight: 500;
}

.fp-group {
  display: inline-block;
}

.fingerprint-hint {
  margin: 10px 0 0;
  font-size: 11.5px;
  color: var(--text-secondary);
  line-height: 1.4;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 16px 24px 20px;
  border-top: 1px solid var(--border-color);
}

.dialog-btn {
  min-width: 96px;
}

.dialog-btn.danger {
  background: var(--danger);
  border-color: var(--danger);
  color: #fff;
}
</style>
