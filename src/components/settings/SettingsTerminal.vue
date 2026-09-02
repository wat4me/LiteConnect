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

function openLogDir() {
  void window.LiteConnect.openSessionLogDir()
}
</script>

<template>
  <section class="settings-content" data-setting="terminal">
    <header class="content-header">
      <h3>{{ t('settingsTerminal.title') }}</h3>
      <p>{{ t('settingsTerminal.intro') }}</p>
    </header>

    <div class="content-grid">
      <div class="settings-card">
        <div class="settings-label" data-setting="terminal.palette">{{ t('settingsTerminal.palette') }}</div>
        <select v-model="draft.terminalPalette" class="settings-select">
          <option v-for="id in terminalPaletteOrder" :key="id" :value="id">
            {{ terminalPaletteLabels[id] }}
          </option>
        </select>

        <div class="settings-label" style="margin-top: 14px" data-setting="terminal.fontFamily">{{ t('settingsTerminal.fontFamily') }}</div>
        <select v-model="draft.terminalFontFamily" class="settings-select">
          <option v-for="item in availableFonts" :key="item.id" :value="item.value">
            {{ item.label }}
          </option>
        </select>

        <div class="settings-label" style="margin-top: 14px" data-setting="terminal.fontSize">{{ t('settingsTerminal.fontSize') }}</div>
        <div class="font-size-row">
          <button type="button" class="font-size-btn" @click="updateFontSize(-1)">−</button>
          <span class="font-size-value">{{ draft.terminalFontSize }}px</span>
          <button type="button" class="font-size-btn" @click="updateFontSize(1)">+</button>
        </div>
        <div class="settings-hint">{{ t('settingsTerminal.fontSizeHint') }}</div>

        <div class="settings-label" style="margin-top: 14px" data-setting="terminal.scrollback">{{ t('settingsTerminal.scrollback') }}</div>
        <select v-model.number="draft.terminalScrollback" class="settings-select">
          <option :value="2000">2000</option>
          <option :value="5000">{{ t('settingsTerminal.scrollbackDefault') }}</option>
          <option :value="10000">10000</option>
          <option :value="20000">20000</option>
        </select>
        <div class="settings-hint">{{ t('settingsTerminal.scrollbackHint') }}</div>

        <label class="settings-check" style="margin-top: 14px" data-setting="terminal.pasteConfirm">
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

        <label class="settings-check" style="margin-top: 14px" data-setting="terminal.commandSuggest">
          <input v-model="draft.terminalCommandSuggestEnabled" type="checkbox" />
          <span>{{ t('settingsTerminal.commandSuggest') }}</span>
        </label>
        <div class="settings-hint">{{ t('settingsTerminal.commandSuggestHint') }}</div>

        <div class="settings-label" style="margin-top: 18px" data-setting="terminal.sessionLog">{{ t('settingsTerminal.sessionLog') }}</div>
        <label class="settings-check">
          <input v-model="draft.sessionLogEnabled" type="checkbox" />
          <span>{{ t('settingsTerminal.sessionLogToggle') }}</span>
        </label>
        <div class="settings-hint">{{ t('settingsTerminal.sessionLogHint') }}</div>
        <button type="button" class="ui-btn session-log-btn" @click="openLogDir">
          {{ t('settingsTerminal.sessionLogOpenDir') }}
        </button>
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


