<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import { setAppLocale, type AppLocale } from '@/i18n'
import { markTipSeen, ONBOARDING_TIPS_KEY, shouldShowTip } from '@/utils/shared/featureTips'
import { clampPopupToViewport } from '@/utils/shared/popupPosition'

const { t, locale } = useI18n()

type TipPlacement = 'bottom' | 'right' | 'left' | 'top'

type OnboardingTip = {
  title: string
  body: string
  /** data-onboarding ids, tried in order (first visible wins) */
  anchors: string[]
  /** Preferred side of the anchor; falls back if no room */
  placement: TipPlacement
}

/** Home / connection-list only — SSH workspace features are left to hover tooltips. */
const tips = computed((): OnboardingTip[] => [
  {
    title: t('connections.tipAppModeTitle'),
    body: t('connections.tipAppModeBody'),
    // The titlebar menu only exists where the module rail is hidden.
    anchors: ['app-mode', 'module-rail'],
    placement: 'bottom',
  },
  {
    title: t('connections.tipAddConnectionTitle'),
    body: t('connections.tipAddConnectionBody'),
    anchors: ['add-connection', 'quick-connect'],
    placement: 'bottom',
  },
  {
    title: t('connections.tipQuickConnectTitle'),
    body: t('connections.tipQuickConnectBody'),
    anchors: ['quick-connect'],
    placement: 'bottom',
  },
  {
    title: t('connections.tipShortcutsTitle'),
    body: t('connections.tipShortcutsBody'),
    anchors: ['shortcuts-help'],
    placement: 'bottom',
  },
])

const visible = ref(false)
const index = ref(0)
const cardRef = ref<HTMLElement | null>(null)
const panelStyle = ref<Record<string, string>>({
  position: 'fixed',
  right: '16px',
  bottom: '16px',
  left: 'auto',
  top: 'auto',
})
const placementClass = ref('placement-fallback')
let highlightedEl: HTMLElement | null = null

const currentTip = computed(() => tips.value[index.value])

function clearHighlight() {
  if (highlightedEl) {
    highlightedEl.classList.remove('onboarding-anchor-active')
    highlightedEl = null
  }
}

function isElementUsable(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  const rect = el.getBoundingClientRect()
  if (rect.width < 2 || rect.height < 2) return false
  const style = window.getComputedStyle(el)
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false
  // Off-screen or fully clipped
  if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
    return false
  }
  return true
}

function findAnchor(ids: string[]): HTMLElement | null {
  for (const id of ids) {
    const nodes = document.querySelectorAll(`[data-onboarding="${id}"]`)
    for (const node of nodes) {
      if (isElementUsable(node)) return node
    }
  }
  return null
}

function preferredPoint(rect: DOMRect, placement: TipPlacement, cardW: number, cardH: number, gap: number) {
  switch (placement) {
    case 'right':
      return { x: rect.right + gap, y: rect.top + rect.height / 2 - cardH / 2 }
    case 'left':
      return { x: rect.left - gap - cardW, y: rect.top + rect.height / 2 - cardH / 2 }
    case 'top':
      return { x: rect.left + rect.width / 2 - cardW / 2, y: rect.top - gap - cardH }
    case 'bottom':
    default:
      return { x: rect.left + rect.width / 2 - cardW / 2, y: rect.bottom + gap }
  }
}

function applyFallback() {
  clearHighlight()
  placementClass.value = 'placement-fallback'
  panelStyle.value = {
    position: 'fixed',
    right: '16px',
    bottom: '16px',
    left: 'auto',
    top: 'auto',
    transform: 'none',
  }
}

function positionTip() {
  if (!visible.value) return
  const tip = currentTip.value
  if (!tip) return

  const anchor = findAnchor(tip.anchors)
  if (!anchor) {
    // Target not on this page (e.g. side toolbar only after a session is open)
    applyFallback()
    return
  }

  clearHighlight()
  anchor.classList.add('onboarding-anchor-active')
  highlightedEl = anchor

  const rect = anchor.getBoundingClientRect()
  const card = cardRef.value
  const cardW = card?.offsetWidth || 320
  const cardH = card?.offsetHeight || 160
  const gap = 10

  const order: TipPlacement[] = [tip.placement, 'bottom', 'top', 'right', 'left']
  let chosen = tip.placement
  let left = 16
  let top = 16

  for (const place of order) {
    const pref = preferredPoint(rect, place, cardW, cardH, gap)
    const clamped = clampPopupToViewport(pref, { width: cardW, height: cardH }, { padding: 12, flip: false })
    // Accept if still near the preferred side (not shoved far away).
    const dx = Math.abs(clamped.left - pref.x)
    const dy = Math.abs(clamped.top - pref.y)
    if (dx < 80 && dy < 80) {
      chosen = place
      left = clamped.left
      top = clamped.top
      break
    }
    // Keep last attempt as best-effort
    chosen = place
    left = clamped.left
    top = clamped.top
  }

  placementClass.value = `placement-${chosen}`
  panelStyle.value = {
    position: 'fixed',
    left: `${left}px`,
    top: `${top}px`,
    right: 'auto',
    bottom: 'auto',
    transform: 'none',
  }
}

function schedulePosition() {
  nextTick(() => {
    positionTip()
    requestAnimationFrame(() => positionTip())
  })
}

onMounted(() => {
  if (!shouldShowTip(ONBOARDING_TIPS_KEY)) return
  visible.value = true
  schedulePosition()
  window.addEventListener('resize', schedulePosition)
  window.addEventListener('scroll', schedulePosition, true)
})

onBeforeUnmount(() => {
  clearHighlight()
  window.removeEventListener('resize', schedulePosition)
  window.removeEventListener('scroll', schedulePosition, true)
})

watch(index, () => schedulePosition())
watch(visible, (v) => {
  if (!v) clearHighlight()
  else schedulePosition()
})

function dismiss() {
  visible.value = false
  clearHighlight()
  markTipSeen(ONBOARDING_TIPS_KEY)
}

function next() {
  if (index.value >= tips.value.length - 1) {
    dismiss()
    return
  }
  index.value += 1
}

async function switchLocale(nextLocale: AppLocale) {
  if (locale.value === nextLocale) return
  setAppLocale(nextLocale, nextLocale)
  schedulePosition()
  try {
    await window.LiteConnect?.setManySettings?.({
      locale: nextLocale,
      localePreference: nextLocale,
    })
  } catch {
    // Keep local selection even if IPC is unavailable.
  }
}
</script>

<template>
  <div
    v-if="visible"
    ref="cardRef"
    class="onboarding"
    :class="placementClass"
    :style="panelStyle"
    role="dialog"
    :aria-label="t('connections.onboardingAria')"
  >
    <div class="onboarding-card">
      <div class="onboarding-head">
        <div class="onboarding-kicker">{{ t('connections.onboardingWelcome', { current: index + 1, total: tips.length }) }}</div>
        <div class="ui-btn-group onboarding-lang-switch" role="group" :aria-label="t('settingsApp.language')">
          <button
            type="button"
            class="ui-btn ui-btn-xs"
            :class="{ active: locale === 'zh-CN' }"
            :aria-pressed="locale === 'zh-CN'"
            @click="switchLocale('zh-CN')"
          >
            {{ t('settingsApp.languageZh') }}
          </button>
          <button
            type="button"
            class="ui-btn ui-btn-xs"
            :class="{ active: locale === 'en-US' }"
            :aria-pressed="locale === 'en-US'"
            @click="switchLocale('en-US')"
          >
            {{ t('settingsApp.languageEn') }}
          </button>
        </div>
      </div>
      <div class="onboarding-title">{{ tips[index].title }}</div>
      <div class="onboarding-body">{{ tips[index].body }}</div>
      <div class="onboarding-actions">
        <button type="button" class="ui-btn ui-btn-sm" @click="dismiss">{{ t('connections.onboardingSkip') }}</button>
        <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" @click="next">
          {{ index >= tips.length - 1 ? t('connections.onboardingStart') : t('connections.onboardingNext') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboarding {
  z-index: 12000;
  max-width: min(360px, calc(100vw - 24px));
  pointer-events: auto;
}

.onboarding-card {
  position: relative;
  padding: 14px 14px 12px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  box-shadow: var(--shadow-menu);
}

/* Small caret toward the anchor */
.onboarding-card::before {
  content: '';
  position: absolute;
  width: 10px;
  height: 10px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  transform: rotate(45deg);
}

.placement-bottom .onboarding-card::before {
  top: -6px;
  left: 24px;
  border-right: none;
  border-bottom: none;
}

.placement-top .onboarding-card::before {
  bottom: -6px;
  left: 24px;
  border-left: none;
  border-top: none;
}

.placement-right .onboarding-card::before {
  left: -6px;
  top: 20px;
  border-right: none;
  border-top: none;
}

.placement-left .onboarding-card::before {
  right: -6px;
  top: 20px;
  border-left: none;
  border-bottom: none;
}

.placement-fallback .onboarding-card::before {
  display: none;
}

.onboarding-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.onboarding-kicker {
  font-size: var(--font-caption);
  font-weight: 600;
  color: var(--text-secondary);
}

.onboarding-lang-switch {
  flex-shrink: 0;
}

.onboarding-title {
  font-size: var(--font-section);
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.onboarding-body {
  font-size: var(--font-ui-sm);
  line-height: 1.5;
  color: var(--text-secondary);
}

.onboarding-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>

<!-- Global so anchor highlight works across components -->
<style>
[data-onboarding].onboarding-anchor-active {
  outline: 2px solid var(--accent) !important;
  outline-offset: 2px;
  border-radius: 8px;
  z-index: 1;
  position: relative;
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--accent) 28%, transparent);
}
</style>
