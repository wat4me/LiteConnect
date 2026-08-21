<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import TerminalPreview from '../terminal/TerminalPreview.vue'
import {
  terminalPaletteOrder,
  terminalPaletteLabels,
  listInstalledFontFamilyPresets,
  pickInstalledFontFamily,
} from '@/composables/app/useTheme'
import type { SettingsDraft } from '@/composables/settings/useSettingsDraft'
import { PASTE_CONFIRM_MAX_CHARS_OPTIONS } from '@/utils/terminal/terminalPaste'

const props = defineProps<{
  draft: SettingsDraft
  isDirty: boolean
}>()

const { t } = useI18n()

const previewCustomColors = computed(() => ({
  bgColor: props.draft.bgColor,
  fontColor: props.draft.fontColor,
}))

/** Only fonts installed on this machine (recomputed after document.fonts.ready). */
const availableFonts = ref(listInstalledFontFamilyPresets())

async function refreshAvailableFonts() {
  try {
    await document.fonts?.ready
  } catch {
    // ignore
  }
  availableFonts.value = listInstalledFontFamilyPresets()
  const next = pickInstalledFontFamily(props.draft.terminalFontFamily)
  if (next !== props.draft.terminalFontFamily) {
    props.draft.terminalFontFamily = next
  }
}

onMounted(() => {
  void refreshAvailableFonts()
})

watch(
  () => props.draft.terminalFontFamily,
  (v) => {
    if (!availableFonts.value.some((f) => f.value === v)) {
      props.draft.terminalFontFamily = pickInstalledFontFamily(v)
    }
  },
)

function updateFontSize(delta: number) {
  const next = props.draft.terminalFontSize + delta
  if (next < 10 || next > 24) return
  props.draft.terminalFontSize = next
}
</script>

<template>
  <section class="settings-content">
    <header class="content-header">
      <h3>{{ t('settingsTerminal.title') }}</h3>
      <p>{{ t('settingsTerminal.intro') }}</p>
    </header>

    <div class="content-grid">
      <div class="settings-card">
        <div class="settings-label">{{ t('settingsTerminal.palette') }}</div>
        <select v-model="draft.terminalPalette" class="settings-select">
          <option v-for="id in terminalPaletteOrder" :key="id" :value="id">
            {{ terminalPaletteLabels[id] }}
          </option>
        </select>

        <div class="settings-label" style="margin-top: 14px">{{ t('settingsTerminal.fontFamily') }}</div>
        <select v-model="draft.terminalFontFamily" class="settings-select">
          <option v-for="item in availableFonts" :key="item.id" :value="item.value">
            {{ item.label }}
          </option>
        </select>

        <div class="settings-label" style="margin-top: 14px">{{ t('settingsTerminal.fontSize') }}</div>
        <div class="font-size-row">
          <button type="button" class="font-size-btn" @click="updateFontSize(-1)">−</button>
          <span class="font-size-value">{{ draft.terminalFontSize }}px</span>
          <button type="button" class="font-size-btn" @click="updateFontSize(1)">+</button>
        </div>
        <div class="settings-hint">{{ t('settingsTerminal.fontSizeHint') }}</div>

        <div class="settings-label" style="margin-top: 14px">{{ t('settingsTerminal.scrollback') }}</div>
        <select v-model.number="draft.terminalScrollback" class="settings-select">
          <option :value="2000">2000</option>
          <option :value="5000">{{ t('settingsTerminal.scrollbackDefault') }}</option>
          <option :value="10000">10000</option>
          <option :value="20000">20000</option>
        </select>
        <div class="settings-hint">{{ t('settingsTerminal.scrollbackHint') }}</div>

        <label class="settings-check" style="margin-top: 14px">
          <input v-model="draft.terminalPasteConfirmEnabled" type="checkbox" />
          <span>{{ t('settingsTerminal.pasteConfirm') }}</span>
        </label>
        <div class="settings-hint">{{ t('settingsTerminal.pasteConfirmHint') }}</div>

        <div class="settings-label" style="margin-top: 14px">{{ t('settingsTerminal.pasteConfirmThreshold') }}</div>
        <select
          v-model.number="draft.terminalPasteConfirmMaxChars"
          class="settings-select"
          :disabled="!draft.terminalPasteConfirmEnabled"
        >
          <option v-for="n in PASTE_CONFIRM_MAX_CHARS_OPTIONS" :key="n" :value="n">
            {{ n === 400 ? t('settingsTerminal.pasteConfirmThresholdDefault', { n }) : String(n) }}
          </option>
        </select>
        <div class="settings-hint">{{ t('settingsTerminal.pasteConfirmThresholdHint') }}</div>

        <label class="settings-check" style="margin-top: 14px">
          <input v-model="draft.terminalCommandSuggestEnabled" type="checkbox" />
          <span>{{ t('settingsTerminal.commandSuggest') }}</span>
        </label>
        <div class="settings-hint">{{ t('settingsTerminal.commandSuggestHint') }}</div>
      </div>

      <div class="preview-card">
        <div class="preview-label">
          {{ t('settingsTerminal.preview') }}
          <span v-if="isDirty" class="preview-badge">{{ t('settingsTerminal.draftBadge') }}</span>
        </div>
        <TerminalPreview
          :theme="draft.theme"
          :custom-colors="previewCustomColors"
          :palette="draft.terminalPalette"
          :font-size="draft.terminalFontSize"
          :font-family="draft.terminalFontFamily"
        />
        <div class="settings-hint" style="margin-top: 8px">
          {{ t('settingsTerminal.previewHint') }}
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.content-header {
  margin-bottom: 20px;
  max-width: 720px;
}

.content-header h3 {
  margin: 0 0 6px;
  font-size: 20px;
  color: var(--text-primary);
}

.content-header p {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.content-grid {
  display: grid;
  grid-template-columns: minmax(280px, 380px) minmax(280px, 1fr);
  gap: 20px;
  align-items: start;
  max-width: 960px;
}

@media (max-width: 900px) {
  .content-grid {
    grid-template-columns: 1fr;
  }
}

.settings-card {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
  padding: 16px;
}

.settings-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.preview-card {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
  padding: 14px;
}

.preview-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 10px;
}

.preview-badge {
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--accent-bg);
  color: var(--accent);
}

/* .settings-select surface styles live in main.css (shared with .ui-select) */

.font-size-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.font-size-btn {
  width: 32px;
  height: 32px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 16px;
  cursor: pointer;
  line-height: 1;
}

.font-size-btn:hover {
  border-color: var(--accent);
  color: var(--accent);
}

.font-size-value {
  min-width: 48px;
  text-align: center;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.settings-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
  user-select: none;
}

.settings-check input {
  margin: 0;
  cursor: pointer;
}

.settings-hint {
  margin-top: 8px;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.45;
}
</style>
