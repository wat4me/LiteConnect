<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { customThemeVariables, useTheme, type Theme } from '@/composables/app/useTheme'
import AppIcon from '@/components/icons/AppIcon.vue'
import {
  FANCY_CURSOR_STYLES,
  type FancyCursorStyle,
} from '@/composables/app/useFancyCursor'
import {
  applyAppBackground,
  type AppBackgroundFit,
} from '@/composables/app/useAppBackground'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { SettingsDraft } from '@/composables/settings/useSettingsDraft'
import { UI_DENSITIES } from '@shared/uiDensity'

const props = defineProps<{
  draft: SettingsDraft
  isDirty: boolean
}>()

const { t } = useI18n()
const { themeOrder, themeLabels } = useTheme()

const themeSwatches: Record<Theme, { bg: string; fg: string }> = {
  dark: { bg: '#262624', fg: '#ece9e1' },
  light: { bg: '#ffffff', fg: '#21201c' },
  eyecare: { bg: '#f5f0e8', fg: '#5c5346' },
  custom: { bg: '#262624', fg: '#ece9e1' },
}

const styleOptions = computed(() =>
  FANCY_CURSOR_STYLES.map((id) => ({
    id,
    label: t(`settingsAppearance.fancyCursorStyles.${id}`),
    desc: t(`settingsAppearance.fancyCursorStyleDescs.${id}`),
  })),
)

/*
 * The preview carries data-theme="<draft theme>", so the theme blocks in
 * main.css resolve every token for it exactly as in the real window. A custom
 * draft gets the same variables useTheme applies to the document root.
 */
const previewThemeVars = computed<Record<string, string>>(() =>
  props.draft.theme === 'custom'
    ? customThemeVariables({ bgColor: props.draft.bgColor, fontColor: props.draft.fontColor })
    : {},
)

const bgFitOptions = computed(() =>
  (['cover', 'contain', 'fill'] as AppBackgroundFit[]).map((id) => ({
    id,
    label: t(`settingsAppearance.bgImageFit.${id}`),
  })),
)

const hasBgImage = computed(
  () => !!props.draft.appBackground.imageUrl && !props.draft.appBackground.cleared,
)

const previewBgStyle = computed(() => {
  const base: Record<string, string> = {
    ...previewThemeVars.value,
    background: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
  }
  if (!hasBgImage.value) return base
  const fit = props.draft.appBackground.fit
  const size = fit === 'fill' ? '100% 100%' : fit
  const overlay = props.draft.appBackground.overlay
  return {
    ...base,
    backgroundImage: [
      `linear-gradient(color-mix(in srgb, var(--bg-primary) ${overlay}%, transparent), color-mix(in srgb, var(--bg-primary) ${overlay}%, transparent))`,
      `url("${props.draft.appBackground.imageUrl.replace(/"/g, '\\"')}")`,
    ].join(', '),
    backgroundSize: `${size}, ${size}`,
    backgroundPosition: 'center, center',
    backgroundRepeat: 'no-repeat, no-repeat',
  }
})

/** Mini demo in preview card — mirrors global style for at-a-glance compare */
const previewRef = ref<HTMLElement | null>(null)
const previewHover = ref(false)
const previewInteractive = ref(false)
const coreX = ref(120)
const coreY = ref(100)
const ringX = ref(120)
const ringY = ref(100)
const trailPts = ref<Array<{ x: number; y: number }>>([])
let idleRaf = 0
let ringRaf = 0
let idleT = 0

function selectTheme(t: Theme) {
  props.draft.theme = t
}

function onBgColorInput(e: Event) {
  props.draft.bgColor = (e.target as HTMLInputElement).value
}

function onFontColorInput(e: Event) {
  props.draft.fontColor = (e.target as HTMLInputElement).value
}

function publishAppBackground() {
  const bg = props.draft.appBackground
  const imageUrl = bg.cleared ? '' : bg.imageUrl
  applyAppBackground({
    imageUrl,
    fit: bg.fit,
    overlay: bg.overlay,
  })
  // Live terminals re-apply xterm bg alpha
  window.dispatchEvent(
    new CustomEvent('app-background-settings-change', {
      detail: { imageUrl, fit: bg.fit, overlay: bg.overlay },
    }),
  )
}

async function pickBackgroundImage() {
  try {
    const picked = await window.LiteConnect.selectAppBackgroundImage()
    if (!picked) return
    props.draft.appBackground = {
      ...props.draft.appBackground,
      imageUrl: picked.imageUrl,
      fileName: picked.fileName,
      token: picked.token,
      cleared: false,
    }
  } catch (err: any) {
    ElMessage.error(err?.message || t('settingsAppearance.bgImagePickFailed'))
  }
}

function clearBackgroundImage() {
  props.draft.appBackground = {
    ...props.draft.appBackground,
    imageUrl: '',
    fileName: '',
    token: '',
    cleared: true,
  }
}

function setBackgroundFit(fit: AppBackgroundFit) {
  props.draft.appBackground.fit = fit
}

function onOverlayInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  props.draft.appBackground.overlay = Number.isFinite(v) ? Math.max(0, Math.min(90, Math.round(v))) : 55
}

function selectCursorStyle(id: FancyCursorStyle) {
  props.draft.fancyCursorStyle = id
}

/** Apply immediately app-wide (still need Save to persist). */
function publishFancyCursor() {
  window.dispatchEvent(
    new CustomEvent('fancy-cursor-settings-change', {
      detail: {
        enabled: props.draft.fancyCursorEnabled,
        style: props.draft.fancyCursorStyle,
      },
    }),
  )
}

function toggleFancyCursor() {
  props.draft.fancyCursorEnabled = !props.draft.fancyCursorEnabled
  // publish handled by watch below
}

function stopPreviewAnims() {
  if (idleRaf) {
    cancelAnimationFrame(idleRaf)
    idleRaf = 0
  }
  if (ringRaf) {
    cancelAnimationFrame(ringRaf)
    ringRaf = 0
  }
}

function tickRingLag() {
  ringRaf = 0
  if (!props.draft.fancyCursorEnabled) return
  const lag = props.draft.fancyCursorStyle === 'dot' ? 0.18 : 0.28
  ringX.value += (coreX.value - ringX.value) * lag
  ringY.value += (coreY.value - ringY.value) * lag
  if (props.draft.fancyCursorStyle === 'trail') {
    const next = [{ x: coreX.value, y: coreY.value }, ...trailPts.value].slice(0, 5)
    trailPts.value = next
  }
  ringRaf = requestAnimationFrame(tickRingLag)
}

function startRingLag() {
  if (ringRaf) return
  ringRaf = requestAnimationFrame(tickRingLag)
}

function tickIdle() {
  idleRaf = 0
  if (!props.draft.fancyCursorEnabled || previewHover.value) return
  idleT += 0.025
  const el = previewRef.value
  const w = el?.clientWidth || 280
  const h = el?.clientHeight || 200
  coreX.value = w * 0.5 + Math.sin(idleT) * w * 0.22
  coreY.value = h * 0.52 + Math.sin(idleT * 2) * h * 0.14
  idleRaf = requestAnimationFrame(tickIdle)
}

function startIdle() {
  if (idleRaf || previewHover.value) return
  idleRaf = requestAnimationFrame(tickIdle)
}

function onPreviewEnter() {
  previewHover.value = true
  if (idleRaf) {
    cancelAnimationFrame(idleRaf)
    idleRaf = 0
  }
}

function onPreviewLeave() {
  previewHover.value = false
  previewInteractive.value = false
  if (props.draft.fancyCursorEnabled) startIdle()
}

function onPreviewMove(e: PointerEvent) {
  if (!props.draft.fancyCursorEnabled) return
  const el = previewRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  coreX.value = e.clientX - rect.left
  coreY.value = e.clientY - rect.top
  const target = e.target instanceof Element ? e.target : null
  previewInteractive.value = !!(
    target?.closest('.ui-preview-btn') ||
    target?.closest('.ui-preview-side-item') ||
    target?.closest('.ui-preview-row')
  )
}

// No `immediate`: avoid publishing empty draft defaults (would flash-off a saved-on cursor).
watch(
  () => [props.draft.fancyCursorEnabled, props.draft.fancyCursorStyle] as const,
  () => {
    publishFancyCursor()
    stopPreviewAnims()
    if (!props.draft.fancyCursorEnabled) {
      previewHover.value = false
      previewInteractive.value = false
      trailPts.value = []
      return
    }
    startRingLag()
    if (!previewHover.value) startIdle()
  },
)

// Preview anim only — when already enabled as page opens after load
watch(
  () => props.draft.fancyCursorEnabled,
  (on) => {
    if (!on) return
    startRingLag()
    if (!previewHover.value) startIdle()
  },
)

// Live wallpaper while editing (discard restores via SettingsView)
watch(
  () => [
    props.draft.appBackground.imageUrl,
    props.draft.appBackground.fit,
    props.draft.appBackground.overlay,
    props.draft.appBackground.cleared,
  ] as const,
  () => {
    publishAppBackground()
  },
)

onBeforeUnmount(() => {
  stopPreviewAnims()
})
</script>

<template>
  <section class="settings-content" data-setting="appearance">
    <header class="content-header">
      <h3>{{ t('settingsAppearance.title') }}</h3>
      <p>{{ t('settingsAppearance.intro') }}</p>
    </header>

    <div class="content-grid">
      <div class="settings-card">
        <div class="settings-label" data-setting="appearance.theme">{{ t('settingsAppearance.theme') }}</div>
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

        <div class="appearance-size-controls">
          <div data-setting="appearance.uiFontSize">
            <label for="appearance-ui-font-size" class="settings-label">{{ t('settingsAppearance.uiFontSize') }}</label>
            <select id="appearance-ui-font-size" v-model="draft.uiFontSize" class="ui-select ui-input-sm" aria-describedby="appearance-ui-font-size-hint">
              <option v-for="size in UI_DENSITIES" :key="size" :value="size">{{ t(`settingsAppearance.uiSize.${size}`) }}</option>
            </select>
            <p id="appearance-ui-font-size-hint" class="settings-hint">{{ t('settingsAppearance.uiFontSizeHint') }}</p>
          </div>
          <div data-setting="appearance.uiDensity">
            <label for="appearance-ui-density" class="settings-label">{{ t('settingsAppearance.uiDensity') }}</label>
            <select id="appearance-ui-density" v-model="draft.uiDensity" class="ui-select ui-input-sm" aria-describedby="appearance-ui-density-hint">
              <option v-for="size in UI_DENSITIES" :key="size" :value="size">{{ t(`settingsAppearance.uiSize.${size}`) }}</option>
            </select>
            <p id="appearance-ui-density-hint" class="settings-hint">{{ t('settingsAppearance.uiDensityHint') }}</p>
          </div>
        </div>

        <div class="settings-label" style="margin-top: 18px" data-setting="appearance.bgImage">{{ t('settingsAppearance.bgImage') }}</div>
        <div class="bg-image-row">
          <button type="button" class="ui-btn" @click="pickBackgroundImage">
            {{ hasBgImage ? t('settingsAppearance.bgImageChange') : t('settingsAppearance.bgImagePick') }}
          </button>
          <button
            v-if="hasBgImage || draft.appBackground.fileName"
            type="button"
            class="ui-btn"
            @click="clearBackgroundImage"
          >
            {{ t('settingsAppearance.bgImageClear') }}
          </button>
        </div>
        <p v-if="hasBgImage && draft.appBackground.fileName" class="settings-hint">
          {{ draft.appBackground.fileName }}
        </p>
        <p class="settings-hint">{{ t('settingsAppearance.bgImageHint') }}</p>
        <template v-if="hasBgImage">
          <div class="settings-label" style="margin-top: 12px">{{ t('settingsAppearance.bgImageFitLabel') }}</div>
          <div class="bg-fit-options ui-btn-group">
            <button
              v-for="opt in bgFitOptions"
              :key="opt.id"
              type="button"
              class="bg-fit-option ui-btn ui-btn-ghost ui-btn-xs"
              :class="{ active: draft.appBackground.fit === opt.id }"
              @click="setBackgroundFit(opt.id)"
            >
              {{ opt.label }}
            </button>
          </div>
          <div class="overlay-row">
            <span>{{ t('settingsAppearance.bgImageOverlay') }}</span>
            <input
              type="range"
              min="0"
              max="90"
              step="5"
              :value="draft.appBackground.overlay"
              @input="onOverlayInput"
            />
            <span class="overlay-value">{{ draft.appBackground.overlay }}%</span>
          </div>
          <p class="settings-hint">{{ t('settingsAppearance.bgImageOverlayHint') }}</p>
        </template>

        <div class="settings-label" style="margin-top: 18px" data-setting="appearance.fancyCursor">{{ t('settingsAppearance.fancyCursor') }}</div>
        <div class="toggle-row">
          <span>{{ draft.fancyCursorEnabled ? t('settingsAppearance.fancyCursorOn') : t('settingsAppearance.fancyCursorOff') }}</span>
          <button
            type="button"
            class="toggle-btn"
            :class="{ active: draft.fancyCursorEnabled }"
            @click="toggleFancyCursor"
          >
            <span class="toggle-knob"></span>
          </button>
        </div>
        <p class="settings-hint">{{ t('settingsAppearance.fancyCursorHint') }}</p>

        <div v-if="draft.fancyCursorEnabled" class="cursor-style-grid">
          <button
            v-for="opt in styleOptions"
            :key="opt.id"
            type="button"
            class="cursor-style-option"
            :class="{ active: draft.fancyCursorStyle === opt.id }"
            @click="selectCursorStyle(opt.id)"
          >
            <span class="cursor-style-name">{{ opt.label }}</span>
            <span class="cursor-style-desc">{{ opt.desc }}</span>
          </button>
        </div>

      </div>

      <div class="preview-card">
        <div class="preview-label">
          {{ t('settingsAppearance.preview') }}
          <span v-if="isDirty" class="preview-badge">{{ t('settingsAppearance.draftBadge') }}</span>
        </div>
        <div
          ref="previewRef"
          class="ui-preview"
          :class="{ 'fancy-cursor-preview': draft.fancyCursorEnabled }"
          :data-theme="draft.theme"
          :style="previewBgStyle"
          @pointerenter="onPreviewEnter"
          @pointerleave="onPreviewLeave"
          @pointermove="onPreviewMove"
        >
          <!-- Same structure and theme tokens as the real shell: titlebar, module rail, framed workspace. -->
          <div class="ui-preview-bar">
            <span class="ui-preview-title">SSH</span>
            <AppIcon name="chevron-down" size="xs" class="ui-preview-chevron" />
          </div>
          <div class="ui-preview-shell">
            <div class="ui-preview-rail" aria-hidden="true">
              <span class="ui-preview-module active"><AppIcon name="terminal" size="xs" /></span>
              <span class="ui-preview-module"><AppIcon name="database" size="xs" /></span>
              <span class="ui-preview-module"><AppIcon name="ai-chat" size="xs" /></span>
            </div>
            <div class="ui-preview-window ui-preview-body">
              <div class="ui-preview-side">
                <div class="ui-preview-side-item active">{{ t('settingsAppearance.previewConnections') }}</div>
                <div class="ui-preview-side-item">{{ t('settingsAppearance.previewGroupA') }}</div>
                <div class="ui-preview-side-item">{{ t('settingsAppearance.previewGroupB') }}</div>
              </div>
              <div class="ui-preview-main">
                <div class="ui-preview-head">
                  <span class="ui-preview-heading">{{ t('groups.defaultGroup') }}</span>
                  <span class="ui-preview-btn">{{ t('connections.newConnection') }}</span>
                </div>
                <div class="ui-preview-tools">
                  <span class="ui-preview-search" />
                  <span class="ui-preview-segment">
                    <span class="active">{{ t('connections.standardList') }}</span>
                    <span>{{ t('connections.compactList') }}</span>
                  </span>
                </div>
                <div class="ui-preview-row">
                  <span class="ui-preview-name">prod-web</span>
                  <span class="ui-preview-meta">root@10.0.0.1</span>
                </div>
                <div class="ui-preview-row">
                  <span class="ui-preview-name">stage-db</span>
                  <span class="ui-preview-meta">ubuntu@10.0.0.2</span>
                </div>
              </div>
            </div>
          </div>

          <template v-if="draft.fancyCursorEnabled">
            <div
              v-if="draft.fancyCursorStyle === 'trail'"
              class="preview-cursor-layer"
            >
              <div
                v-for="(p, i) in trailPts"
                :key="i"
                class="preview-trail-dot"
                :style="{
                  transform: `translate3d(${p.x}px, ${p.y}px, 0)`,
                  opacity: Math.max(0.12, 0.55 - i * 0.1),
                }"
              />
            </div>
            <div
              v-if="draft.fancyCursorStyle === 'ring' || draft.fancyCursorStyle === 'dot'"
              class="preview-cursor-ring"
              :class="{
                interactive: previewInteractive && previewHover,
                'as-dot': draft.fancyCursorStyle === 'dot',
              }"
              :style="{ transform: `translate3d(${ringX}px, ${ringY}px, 0)` }"
              aria-hidden="true"
            />
            <div
              v-if="draft.fancyCursorStyle === 'ring' || draft.fancyCursorStyle === 'trail' || draft.fancyCursorStyle === 'cross'"
              class="preview-cursor-core"
              :class="{ 'as-cross': draft.fancyCursorStyle === 'cross' }"
              :style="{ transform: `translate3d(${coreX}px, ${coreY}px, 0)` }"
              aria-hidden="true"
            >
              <template v-if="draft.fancyCursorStyle === 'cross'">
                <i /><i />
              </template>
            </div>
            <div v-if="!previewHover" class="preview-cursor-tip">
              {{ t('settingsAppearance.fancyCursorPreviewTip') }}
            </div>
          </template>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.appearance-size-controls {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr));
  gap: var(--space-3);
  margin-top: var(--space-4);
}

.appearance-size-controls .settings-label { display: block; }

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

.theme-option:hover,
.cursor-style-option:hover {
  border-color: color-mix(in srgb, var(--text-primary) 22%, var(--border-color));
  background: var(--tab-hover-surface);
}

/* Selected choice card: neutral lift, same as other selected states. */
.theme-option.active,
.cursor-style-option.active {
  border-color: color-mix(in srgb, var(--text-primary) 35%, var(--border-color));
  background: var(--tab-selected-surface);
  color: var(--text-primary);
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

.bg-image-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.overlay-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
  font-size: 12px;
  color: var(--text-primary);
}

.overlay-row input[type='range'] {
  flex: 1;
  min-width: 0;
}

.overlay-value {
  min-width: 36px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}

.cursor-style-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-top: 12px;
}

.cursor-style-option {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  cursor: pointer;
  text-align: left;
}

.cursor-style-name {
  font-size: 12px;
  font-weight: 600;
}

.cursor-style-desc {
  font-size: 10px;
  color: var(--text-secondary);
  line-height: 1.35;
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
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}

.ui-preview {
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--border-color) 85%, transparent);
  min-height: 200px;
}

.ui-preview.fancy-cursor-preview {
  cursor: none;
}

.ui-preview.fancy-cursor-preview * {
  cursor: none;
}

.preview-cursor-ring,
.preview-cursor-core,
.preview-trail-dot {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  z-index: 5;
  will-change: transform;
}

.preview-cursor-ring {
  width: 28px;
  height: 28px;
  margin: -14px 0 0 -14px;
  border-radius: 50%;
  border: 1.5px solid color-mix(in srgb, var(--accent) 75%, transparent);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 22%, transparent);
  transition: width 0.15s ease, height 0.15s ease, margin 0.15s ease, background 0.15s ease;
}

.preview-cursor-ring.as-dot {
  width: 16px;
  height: 16px;
  margin: -8px 0 0 -8px;
  border: none;
  background: color-mix(in srgb, var(--accent) 70%, transparent);
  box-shadow: 0 0 14px color-mix(in srgb, var(--accent) 40%, transparent);
  filter: blur(0.2px);
}

.preview-cursor-ring.interactive:not(.as-dot) {
  width: 36px;
  height: 36px;
  margin: -18px 0 0 -18px;
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.preview-cursor-core {
  width: 6px;
  height: 6px;
  margin: -3px 0 0 -3px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 6px color-mix(in srgb, var(--accent) 45%, transparent);
}

.preview-cursor-core.as-cross {
  width: 18px;
  height: 18px;
  margin: -9px 0 0 -9px;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}

.preview-cursor-core.as-cross i {
  position: absolute;
  background: var(--accent);
  border-radius: 1px;
  box-shadow: 0 0 4px color-mix(in srgb, var(--accent) 40%, transparent);
}

.preview-cursor-core.as-cross i:first-child {
  left: 50%;
  top: 0;
  width: 1.5px;
  height: 100%;
  transform: translateX(-50%);
}

.preview-cursor-core.as-cross i:last-child {
  top: 50%;
  left: 0;
  height: 1.5px;
  width: 100%;
  transform: translateY(-50%);
}

.preview-trail-dot {
  width: 8px;
  height: 8px;
  margin: -4px 0 0 -4px;
  border-radius: 50%;
  background: var(--accent);
}

.preview-cursor-tip {
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 8px;
  z-index: 4;
  pointer-events: none;
  text-align: center;
  font-size: 10px;
  color: color-mix(in srgb, var(--text-secondary) 80%, transparent);
  opacity: 0.9;
}

/* Mirrors the real shell; every color is a theme token resolved by data-theme. */
.ui-preview-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  height: 26px;
  padding: 0 10px;
  background: var(--titlebar-bg, var(--bg-secondary));
}
.ui-preview-title {
  font-family: var(--font-serif);
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.ui-preview-chevron { color: var(--text-secondary); }
.ui-preview-shell {
  display: flex;
  gap: 4px;
  padding: 0 6px 6px 0;
}
.ui-preview-rail {
  width: 32px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding-top: 2px;
}
.ui-preview-module {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}
.ui-preview-module.active {
  color: var(--text-primary);
  background: var(--tab-selected-surface);
  box-shadow: inset 0 0 0 1px var(--tab-selected-edge), var(--tab-selected-shadow);
}
.ui-preview-window {
  flex: 1;
  min-width: 0;
  display: flex;
  min-height: 170px;
  overflow: hidden;
  border: 1px solid var(--window-edge);
  border-radius: 10px;
  background: var(--bg-secondary);
  box-shadow: var(--window-shadow);
}
.ui-preview-side {
  width: 84px;
  flex-shrink: 0;
  padding: 8px 6px;
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ui-preview-side-item {
  font-size: 11px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
}
.ui-preview-side-item.active {
  color: var(--text-primary);
  font-weight: 600;
  background: var(--tab-selected-surface);
  box-shadow: inset 0 0 0 1px var(--tab-selected-edge), var(--tab-selected-shadow);
}
.ui-preview-main {
  flex: 1;
  min-width: 0;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ui-preview-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 2px;
}
.ui-preview-heading {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
}
.ui-preview-tools {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-color);
}
.ui-preview-search {
  flex: 1;
  height: 20px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  background: var(--bg-primary);
}
.ui-preview-segment {
  display: inline-flex;
  gap: 1px;
  padding: 2px;
  border-radius: var(--radius-sm);
  background: var(--segment-track);
  font-size: 10px;
  color: var(--text-secondary);
}
.ui-preview-segment > span {
  padding: 1px 6px;
  border-radius: 4px;
  white-space: nowrap;
}
.ui-preview-segment > .active {
  color: var(--text-primary);
  font-weight: 600;
  background: var(--segment-selected);
  box-shadow: var(--segment-selected-shadow);
}
.ui-preview-row {
  padding: 6px 10px;
  border-radius: var(--radius-md);
  border: 1px solid color-mix(in srgb, var(--border-color) 80%, transparent);
  background: var(--bg-primary);
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.ui-preview-name {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary);
}
.ui-preview-meta {
  font-size: 10px;
  color: var(--text-secondary);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}
.ui-preview-btn {
  flex-shrink: 0;
  padding: 3px 10px;
  border-radius: var(--radius-sm);
  font-size: 11px;
  font-weight: 500;
  color: #fff;
  background: var(--accent);
  white-space: nowrap;
}
</style>
