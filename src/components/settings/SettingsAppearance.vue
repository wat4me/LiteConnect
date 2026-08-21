<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useTheme, type Theme } from '@/composables/app/useTheme'
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

const styleOptions = computed(() =>
  FANCY_CURSOR_STYLES.map((id) => ({
    id,
    label: t(`settingsAppearance.fancyCursorStyles.${id}`),
    desc: t(`settingsAppearance.fancyCursorStyleDescs.${id}`),
  })),
)

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
    background: previewUi.value.bg,
    color: previewUi.value.fg,
  }
  if (!hasBgImage.value) return base
  const fit = props.draft.appBackground.fit
  const size = fit === 'fill' ? '100% 100%' : fit
  const overlay = props.draft.appBackground.overlay
  return {
    ...base,
    backgroundImage: [
      `linear-gradient(color-mix(in srgb, ${previewUi.value.bg} ${overlay}%, transparent), color-mix(in srgb, ${previewUi.value.bg} ${overlay}%, transparent))`,
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

        <div class="settings-label" style="margin-top: 18px">{{ t('settingsAppearance.bgImage') }}</div>
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
          <div class="bg-fit-options">
            <button
              v-for="opt in bgFitOptions"
              :key="opt.id"
              type="button"
              class="bg-fit-option"
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

        <div class="settings-label" style="margin-top: 18px">{{ t('settingsAppearance.fancyCursor') }}</div>
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
          :style="previewBgStyle"
          @pointerenter="onPreviewEnter"
          @pointerleave="onPreviewLeave"
          @pointermove="onPreviewMove"
        >
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

.toggle-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 13px;
  color: var(--text-primary);
}

.toggle-btn {
  position: relative;
  width: 40px;
  height: 22px;
  border-radius: 11px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  cursor: pointer;
  padding: 0;
  flex-shrink: 0;
  transition: background 0.15s ease, border-color 0.15s ease;
}

.toggle-btn.active {
  background: var(--accent);
  border-color: var(--accent);
}

.toggle-knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text-secondary);
  transition: transform 0.15s ease, background 0.15s ease;
}

.toggle-btn.active .toggle-knob {
  transform: translateX(18px);
  background: #fff;
}

.settings-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
}

.bg-image-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.bg-fit-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.bg-fit-option {
  padding: 5px 10px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  font-size: 12px;
  cursor: pointer;
}

.bg-fit-option:hover {
  border-color: var(--accent);
}

.bg-fit-option.active {
  border-color: var(--accent);
  background: var(--accent-bg);
  color: var(--accent);
  font-weight: 600;
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

.cursor-style-option:hover {
  border-color: var(--accent);
}

.cursor-style-option.active {
  border-color: var(--accent);
  background: var(--accent-bg);
}

.cursor-style-name {
  font-size: 12px;
  font-weight: 600;
}

.cursor-style-option.active .cursor-style-name {
  color: var(--accent);
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
  position: relative;
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(128, 128, 128, 0.25);
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
