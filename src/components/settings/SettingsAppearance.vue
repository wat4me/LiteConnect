<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme, type Theme } from '@/composables/app/useTheme'
import type { SettingsDraft } from '@/composables/settings/useSettingsDraft'

const props = defineProps<{
  draft: SettingsDraft
  isDirty: boolean
}>()

const { t } = useI18n()
const { themeOrder, themeLabels } = useTheme()

const themeSwatches: Record<Theme, { bg: string; fg: string }> = {
  dark: { bg: '#0d1117', fg: '#e6edf3' },
  light: { bg: '#ffffff', fg: '#1f2328' },
  eyecare: { bg: '#f5f0e8', fg: '#5c5346' },
  custom: { bg: '#0d1117', fg: '#e6edf3' },
}

function mix(hex1: string, hex2: string, ratio: number): string {
  const parse = (h: string) => {
    const n = h.replace('#', '')
    if (n.length !== 6) return [13, 17, 23]
    return [parseInt(n.slice(0, 2), 16), parseInt(n.slice(2, 4), 16), parseInt(n.slice(4, 6), 16)]
  }
  const [r1, g1, b1] = parse(hex1)
  const [r2, g2, b2] = parse(hex2)
  const r = Math.round(r1 + (r2 - r1) * ratio)
  const g = Math.round(g1 + (g2 - g1) * ratio)
  const b = Math.round(b1 + (b2 - b1) * ratio)
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`
}

const previewUi = computed(() => {
  if (props.draft.theme === 'custom') {
    return {
      bg: props.draft.bgColor,
      fg: props.draft.fontColor,
      secondary: mix(props.draft.bgColor, props.draft.fontColor, 0.12),
    }
  }
  const s = themeSwatches[props.draft.theme]
  return { bg: s.bg, fg: s.fg, secondary: mix(s.bg, s.fg, 0.12) }
})

function selectTheme(t: Theme) {
  props.draft.theme = t
}

function onBgColorInput(e: Event) {
  props.draft.bgColor = (e.target as HTMLInputElement).value
}

function onFontColorInput(e: Event) {
  props.draft.fontColor = (e.target as HTMLInputElement).value
}
</script>

<template>
  <section class="settings-content">
    <header class="content-header">
      <h3>{{ t('settingsAppearance.title') }}</h3>
      <p>{{ t('settingsAppearance.intro') }}</p>
    </header>

    <div class="content-grid">
      <div class="settings-card">
        <div class="settings-label">{{ t('settingsAppearance.theme') }}</div>
        <div class="theme-options">
          <button
            v-for="t in themeOrder"
            :key="t"
            type="button"
            class="theme-option"
            :class="{ active: draft.theme === t }"
            @click="selectTheme(t)"
          >
            <span
              class="theme-swatch"
              :style="{
                backgroundColor: t === 'custom' ? draft.bgColor : themeSwatches[t].bg,
                color: t === 'custom' ? draft.fontColor : themeSwatches[t].fg,
              }"
            >Aa</span>
            <span>{{ themeLabels[t as Theme] }}</span>
          </button>
        </div>

        <template v-if="draft.theme === 'custom'">
          <div class="color-row">
            <label>{{ t('settingsAppearance.bgColor') }}</label>
            <div class="color-input-group">
              <input type="color" :value="draft.bgColor" class="color-picker" @input="onBgColorInput" />
              <input type="text" :value="draft.bgColor" class="color-hex" @change="onBgColorInput" />
            </div>
          </div>
          <div class="color-row">
            <label>{{ t('settingsAppearance.fontColor') }}</label>
            <div class="color-input-group">
              <input type="color" :value="draft.fontColor" class="color-picker" @input="onFontColorInput" />
              <input type="text" :value="draft.fontColor" class="color-hex" @change="onFontColorInput" />
            </div>
          </div>
        </template>
      </div>

      <div class="preview-card">
        <div class="preview-label">
          {{ t('settingsAppearance.preview') }}
          <span v-if="isDirty" class="preview-badge">{{ t('settingsAppearance.draftBadge') }}</span>
        </div>
        <div class="ui-preview" :style="{ background: previewUi.bg, color: previewUi.fg }">
          <div class="ui-preview-bar" :style="{ background: previewUi.secondary, borderColor: mix(previewUi.bg, previewUi.fg, 0.2) }">
            <span class="ui-preview-dot" />
            <span class="ui-preview-dot" />
            <span class="ui-preview-title">LiteConnect</span>
          </div>
          <div class="ui-preview-body">
            <div class="ui-preview-side" :style="{ background: previewUi.secondary, borderColor: mix(previewUi.bg, previewUi.fg, 0.2) }">
              <div class="ui-preview-side-item active">{{ t('settingsAppearance.previewConnections') }}</div>
              <div class="ui-preview-side-item">{{ t('settingsAppearance.previewGroupA') }}</div>
              <div class="ui-preview-side-item">{{ t('settingsAppearance.previewGroupB') }}</div>
            </div>
            <div class="ui-preview-main">
              <div class="ui-preview-row" :style="{ borderColor: mix(previewUi.bg, previewUi.fg, 0.18) }">
                <span class="ui-preview-name">prod-web</span>
                <span class="ui-preview-meta" :style="{ color: mix(previewUi.fg, previewUi.bg, 0.4) }">root@10.0.0.1</span>
              </div>
              <div class="ui-preview-row" :style="{ borderColor: mix(previewUi.bg, previewUi.fg, 0.18) }">
                <span class="ui-preview-name">stage-db</span>
                <span class="ui-preview-meta" :style="{ color: mix(previewUi.fg, previewUi.bg, 0.4) }">ubuntu@10.0.0.2</span>
              </div>
              <div class="ui-preview-btn" :style="{ background: 'var(--accent)', color: '#fff' }">{{ t('settingsAppearance.previewConnect') }}</div>
            </div>
          </div>
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

.theme-options {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.theme-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  font-size: 12px;
}

.theme-option:hover {
  border-color: var(--accent);
}

.theme-option.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent);
}

.theme-swatch {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid rgba(128, 128, 128, 0.25);
  flex-shrink: 0;
}

.color-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 12px;
  gap: 12px;
  font-size: 13px;
  color: var(--text-primary);
}

.color-input-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.color-picker {
  width: 32px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
}

.color-hex {
  width: 88px;
  padding: 4px 8px;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  font-family: ui-monospace, Consolas, monospace;
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

.ui-preview {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(128, 128, 128, 0.25);
  min-height: 200px;
}

.ui-preview-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid;
}

.ui-preview-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.35;
}

.ui-preview-title {
  margin-left: 4px;
  font-size: 11px;
  font-weight: 600;
  opacity: 0.85;
}

.ui-preview-body {
  display: flex;
  min-height: 150px;
}

.ui-preview-side {
  width: 88px;
  padding: 10px 8px;
  border-right: 1px solid;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.ui-preview-side-item {
  font-size: 11px;
  padding: 5px 8px;
  border-radius: 6px;
  opacity: 0.75;
}

.ui-preview-side-item.active {
  background: var(--accent-bg);
  color: var(--accent);
  opacity: 1;
  font-weight: 600;
}

.ui-preview-main {
  flex: 1;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.ui-preview-row {
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ui-preview-name {
  font-size: 12px;
  font-weight: 600;
}

.ui-preview-meta {
  font-size: 10px;
  font-family: ui-monospace, Consolas, monospace;
}

.ui-preview-btn {
  align-self: flex-start;
  margin-top: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
}
</style>
