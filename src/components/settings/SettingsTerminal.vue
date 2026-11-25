<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { emitAppEvent } from '@/utils/shared/appEvents'
import { useI18n } from 'vue-i18n'
import TerminalPreview from '../terminal/TerminalPreview.vue'
import {
  terminalPaletteOrder,
  terminalPaletteLabels,
  listInstalledFontFamilyPresets,
  pickInstalledFontFamily,
  getTerminalColors,
} from '@/composables/app/useTheme'
import type { SettingsDraft } from '@/composables/settings/useSettingsDraft'
import { PASTE_CONFIRM_MAX_CHARS_OPTIONS } from '@/utils/terminal/terminalPaste'
import {
  TERMINAL_HIGHLIGHT_COLORS,
  cloneDefaultTerminalHighlightRules,
  validateTerminalHighlightPattern,
  type TerminalHighlightColor,
  type TerminalHighlightRule,
} from '@shared/terminalHighlight'
import AppIcon from '../icons/AppIcon.vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm } from '@/composables/app/useAppDialog'

const props = defineProps<{
  draft: SettingsDraft
  isDirty: boolean
}>()

const { t } = useI18n()

const previewCustomColors = computed(() => ({
  bgColor: props.draft.bgColor,
  fontColor: props.draft.fontColor,
}))

const previewPaletteColors = computed<Record<TerminalHighlightColor, string>>(() => {
  const palette = getTerminalColors(props.draft.theme, previewCustomColors.value, props.draft.terminalPalette)
  return {
    red: palette.red || '#e06c75',
    yellow: palette.yellow || '#d19a66',
    green: palette.green || '#98c379',
    cyan: palette.cyan || '#56b6c2',
    blue: palette.blue || '#61afef',
    magenta: palette.magenta || '#c678dd',
  }
})

const editingRuleId = ref<string | null>(null)
const ruleForm = ref<TerminalHighlightRule | null>(null)
const ruleError = ref('')

function startAddRule() {
  editingRuleId.value = '__new__'
  ruleError.value = ''
  ruleForm.value = {
    id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: '',
    pattern: '',
    isRegex: false,
    caseSensitive: false,
    color: 'yellow',
    bold: true,
    background: false,
    overrideColor: false,
    enabled: true,
  }
}

function startEditRule(rule: TerminalHighlightRule) {
  editingRuleId.value = rule.id
  ruleError.value = ''
  ruleForm.value = { ...rule }
}

function cancelRuleEdit() {
  editingRuleId.value = null
  ruleForm.value = null
  ruleError.value = ''
}

function saveRuleForm() {
  const form = ruleForm.value
  if (!form) return
  const err = validateTerminalHighlightPattern(form.pattern, form.isRegex)
  if (err) {
    if (err === 'empty') ruleError.value = t('settingsTerminal.highlightInvalidEmpty')
    else if (err === 'tooLong') ruleError.value = t('settingsTerminal.highlightInvalidTooLong')
    else ruleError.value = t('settingsTerminal.highlightInvalidRegex', { detail: err })
    return
  }
  const normalized: TerminalHighlightRule = {
    ...form,
    name: form.name.trim() || form.pattern.trim(),
    pattern: form.pattern.trim(),
  }
  if (editingRuleId.value === '__new__') {
    props.draft.terminalHighlightRules = [normalized, ...props.draft.terminalHighlightRules]
  } else {
    props.draft.terminalHighlightRules = props.draft.terminalHighlightRules.map(item =>
      item.id === editingRuleId.value ? normalized : item,
    )
  }
  cancelRuleEdit()
}

function moveRule(index: number, delta: -1 | 1) {
  const target = index + delta
  const list = props.draft.terminalHighlightRules
  if (target < 0 || target >= list.length) return
  const next = [...list]
  const [moved] = next.splice(index, 1)
  next.splice(target, 0, moved)
  props.draft.terminalHighlightRules = next
}

function deleteRule(id: string) {
  props.draft.terminalHighlightRules = props.draft.terminalHighlightRules.filter(item => item.id !== id)
  if (editingRuleId.value === id) cancelRuleEdit()
}

function resetHighlightRules() {
  props.draft.terminalHighlightRules = cloneDefaultTerminalHighlightRules()
  cancelRuleEdit()
}

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

async function clearCommandHistory() {
  try {
    await appConfirm({
      title: t('settingsTerminal.clearHistoryTitle'),
      message: t('settingsTerminal.clearHistoryMessage'),
      detail: t('settingsTerminal.clearHistoryDetail'),
      confirmText: t('common.clear'),
      cancelText: t('common.cancel'),
      tone: 'warning',
      danger: true,
    })
  } catch {
    return
  }
  try {
    await window.LiteConnect.clearShellCommandHistory()
    emitAppEvent('shell-command-history-cleared')
    ElMessage.success(t('settingsTerminal.clearHistoryDone'))
  } catch (err: any) {
    ElMessage.error(err?.message || t('settingsTerminal.clearHistoryFailed'))
  }
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
          <div class="ui-btn-group">
            <button type="button" class="ui-icon-btn ui-icon-btn-sm font-size-btn" :title="t('common.decrease')" :aria-label="t('common.decrease')" @click="updateFontSize(-1)"><AppIcon name="minus" size="xs" /></button>
            <span class="font-size-value ui-btn-group-value">{{ draft.terminalFontSize }}px</span>
            <button type="button" class="ui-icon-btn ui-icon-btn-sm font-size-btn" :title="t('common.increase')" :aria-label="t('common.increase')" @click="updateFontSize(1)"><AppIcon name="plus" size="xs" /></button>
          </div>
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

        <label class="settings-check" style="margin-top: 14px" data-setting="terminal.localEcho">
          <input v-model="draft.terminalLocalEchoEnabled" type="checkbox" />
          <span>{{ t('settingsTerminal.localEcho') }}</span>
        </label>
        <div class="settings-hint">{{ t('settingsTerminal.localEchoHint') }}</div>

        <div class="settings-label" style="margin-top: 14px" data-setting="terminal.commandHistoryPrivacy">
          {{ t('settingsTerminal.commandHistoryPrivacy') }}
        </div>
        <textarea
          v-model="draft.terminalCommandHistoryExcludePatterns"
          class="ui-textarea ui-input-sm ui-input-mono command-history-patterns"
          :placeholder="t('settingsTerminal.commandHistoryPrivacyPlaceholder')"
          rows="3"
          spellcheck="false"
        ></textarea>
        <div class="settings-hint">{{ t('settingsTerminal.commandHistoryPrivacyHint') }}</div>
        <button type="button" class="ui-btn session-log-btn" @click="clearCommandHistory">
          {{ t('settingsTerminal.clearHistory') }}
        </button>

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
          :highlight-enabled="draft.terminalHighlightEnabled"
          :highlight-rules="draft.terminalHighlightRules"
        />
        <div class="settings-hint" style="margin-top: 8px">
          {{ t('settingsTerminal.previewHint') }}
        </div>

        <div class="highlight-section" data-setting="terminal.highlight">
          <div class="highlight-header">
            <div class="settings-label" style="margin: 0">{{ t('settingsTerminal.highlightTitle') }}</div>
            <div class="highlight-header-actions">
              <button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="resetHighlightRules">
                {{ t('settingsTerminal.highlightReset') }}
              </button>
              <button type="button" class="ui-btn ui-btn-xs" @click="startAddRule">
                <AppIcon name="plus" size="xs" />
                <span>{{ t('settingsTerminal.highlightAdd') }}</span>
              </button>
            </div>
          </div>

          <label class="settings-check" style="margin-top: 8px">
            <input v-model="draft.terminalHighlightEnabled" type="checkbox" />
            <span>{{ t('settingsTerminal.highlightToggle') }}</span>
          </label>
          <div class="settings-hint">{{ t('settingsTerminal.highlightHint') }}</div>

          <div v-if="ruleForm" class="highlight-editor">
            <div class="highlight-editor-grid">
              <label class="highlight-field">
                <span>{{ t('settingsTerminal.highlightName') }}</span>
                <input
                  v-model="ruleForm.name"
                  type="text"
                  class="ui-input ui-input-sm"
                  :placeholder="t('settingsTerminal.highlightNamePlaceholder')"
                />
              </label>
              <label class="highlight-field">
                <span>{{ t('settingsTerminal.highlightPattern') }}</span>
                <input
                  v-model="ruleForm.pattern"
                  type="text"
                  class="ui-input ui-input-sm ui-input-mono"
                  spellcheck="false"
                  :placeholder="t('settingsTerminal.highlightPatternPlaceholder')"
                  @input="ruleError = ''"
                />
              </label>
            </div>
            <p v-if="ruleError" class="highlight-error" role="alert">{{ ruleError }}</p>
            <div class="highlight-editor-options">
              <div class="highlight-colors" role="radiogroup" :aria-label="t('settingsTerminal.highlightColor')">
                <button
                  v-for="color in TERMINAL_HIGHLIGHT_COLORS"
                  :key="color"
                  type="button"
                  class="highlight-color-btn"
                  :class="{ active: ruleForm.color === color }"
                  :title="t(`settingsTerminal.highlightColor_${color}`)"
                  :aria-label="t(`settingsTerminal.highlightColor_${color}`)"
                  :aria-checked="ruleForm.color === color"
                  role="radio"
                  @click="ruleForm.color = color"
                >
                  <span class="highlight-color-dot" :style="{ background: previewPaletteColors[color] }" />
                </button>
              </div>
              <label class="highlight-opt"><input v-model="ruleForm.isRegex" type="checkbox" /><span>{{ t('settingsTerminal.highlightRegex') }}</span></label>
              <label class="highlight-opt"><input v-model="ruleForm.caseSensitive" type="checkbox" /><span>{{ t('settingsTerminal.highlightCaseSensitive') }}</span></label>
              <label class="highlight-opt"><input v-model="ruleForm.bold" type="checkbox" /><span>{{ t('settingsTerminal.highlightBold') }}</span></label>
              <label class="highlight-opt"><input v-model="ruleForm.background" type="checkbox" /><span>{{ t('settingsTerminal.highlightBackground') }}</span></label>
              <label class="highlight-opt"><input v-model="ruleForm.overrideColor" type="checkbox" /><span>{{ t('settingsTerminal.highlightOverrideColor') }}</span></label>
            </div>
            <div class="highlight-editor-footer">
              <button type="button" class="ui-btn ui-btn-ghost ui-btn-xs" @click="cancelRuleEdit">{{ t('common.cancel') }}</button>
              <button type="button" class="ui-btn ui-btn-primary ui-btn-xs" @click="saveRuleForm">{{ t('settingsTerminal.highlightSaveRule') }}</button>
            </div>
          </div>

          <div v-if="draft.terminalHighlightRules.length === 0" class="highlight-empty">
            {{ t('settingsTerminal.highlightEmpty') }}
          </div>
          <div v-else class="highlight-rule-list" :class="{ disabled: !draft.terminalHighlightEnabled }">
            <div v-for="(rule, index) in draft.terminalHighlightRules" :key="rule.id" class="highlight-rule-row">
              <input v-model="rule.enabled" type="checkbox" class="highlight-rule-check" :aria-label="rule.name" />
              <span
                class="highlight-rule-swatch"
                :class="{ 'is-bg': rule.background, 'is-bold': rule.bold }"
                :style="rule.background ? { background: previewPaletteColors[rule.color], color: '#fff' } : { color: previewPaletteColors[rule.color] }"
              >Aa</span>
              <div class="highlight-rule-info">
                <div class="highlight-rule-head">
                  <span class="highlight-rule-name">{{ rule.name }}</span>
                  <span v-if="rule.isRegex" class="highlight-tag">{{ t('settingsTerminal.highlightRegex') }}</span>
                  <span v-if="rule.caseSensitive" class="highlight-tag">Aa</span>
                  <span v-if="rule.overrideColor" class="highlight-tag">{{ t('settingsTerminal.highlightOverrideColor') }}</span>
                </div>
                <span class="highlight-rule-pattern" :title="rule.pattern">{{ rule.pattern }}</span>
              </div>
              <div class="highlight-rule-actions">
                <button
                  type="button"
                  class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
                  :disabled="index === 0"
                  :title="t('settingsTerminal.highlightMoveUp')"
                  :aria-label="t('settingsTerminal.highlightMoveUp')"
                  @click="moveRule(index, -1)"
                >
                  <AppIcon name="chevron-up" size="xs" />
                </button>
                <button
                  type="button"
                  class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm"
                  :disabled="index === draft.terminalHighlightRules.length - 1"
                  :title="t('settingsTerminal.highlightMoveDown')"
                  :aria-label="t('settingsTerminal.highlightMoveDown')"
                  @click="moveRule(index, 1)"
                >
                  <AppIcon name="chevron-down" size="xs" />
                </button>
                <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" :title="t('settingsTerminal.highlightEdit')" :aria-label="t('settingsTerminal.highlightEdit')" @click="startEditRule(rule)">
                  <AppIcon name="edit" size="xs" />
                </button>
                <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-danger" :title="t('common.delete')" :aria-label="t('common.delete')" @click="deleteRule(rule.id)">
                  <AppIcon name="delete" size="xs" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.command-history-patterns {
  width: 100%;
  resize: vertical;
}

.highlight-section {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
}

.highlight-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.highlight-header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.highlight-editor {
  margin-top: 10px;
  padding: 12px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.highlight-editor-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.3fr);
  gap: 8px;
}

.highlight-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--font-caption);
  color: var(--text-secondary);
}

.highlight-error {
  margin: 0;
  font-size: var(--font-caption);
  color: var(--danger);
}

.highlight-editor-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.highlight-colors {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.highlight-color-btn {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1.5px solid transparent;
  border-radius: 50%;
  background: transparent;
  display: grid;
  place-items: center;
  cursor: pointer;
}

.highlight-color-btn.active {
  border-color: var(--text-primary);
}

.highlight-color-dot {
  width: 13px;
  height: 13px;
  border-radius: 50%;
}

.highlight-opt {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-caption);
  color: var(--text-secondary);
  cursor: pointer;
}

.highlight-opt input {
  margin: 0;
  accent-color: var(--accent);
}

.highlight-editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.highlight-empty {
  margin-top: 10px;
  padding: 14px;
  border: 1px dashed var(--border-color);
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  font-size: var(--font-ui-sm);
  text-align: center;
}

.highlight-rule-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.highlight-rule-list.disabled {
  opacity: 0.55;
}

.highlight-rule-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
}

.highlight-rule-check {
  margin: 0;
  accent-color: var(--accent);
  cursor: pointer;
  flex-shrink: 0;
}

.highlight-rule-swatch {
  width: 24px;
  height: 20px;
  border-radius: 4px;
  border: 1px solid color-mix(in srgb, var(--border-color) 70%, transparent);
  display: grid;
  place-items: center;
  font-size: 11px;
  font-family: var(--font-mono, monospace);
  flex-shrink: 0;
}

.highlight-rule-swatch.is-bold {
  font-weight: 700;
}

.highlight-rule-swatch.is-bg {
  border-color: transparent;
}

.highlight-rule-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.highlight-rule-head {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.highlight-rule-name {
  font-size: var(--font-ui-sm);
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.highlight-tag {
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 10px;
  flex-shrink: 0;
}

.highlight-rule-pattern {
  font-size: var(--font-caption);
  font-family: var(--font-mono, monospace);
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.highlight-rule-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
</style>
