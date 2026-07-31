<script setup lang="ts">
/**
 * Unified stroke icons (Feather/Lucide style, viewBox 0 0 24 24).
 *
 * Sizing:
 * - Prefer semantic tokens: xs | sm | md | lg | xl | 2xl | hero
 * - Tokens map to CSS vars (--icon-*) which scale with --ui-scale
 * - Number / px string still accepted for one-off sizes
 * - Omit size to inherit from parent (e.g. .ui-icon-btn)
 */
import { computed } from 'vue'

export type AppIconName =
  | 'close'
  | 'plus'
  | 'search'
  | 'download'
  | 'upload'
  | 'edit'
  | 'delete'
  | 'trash'
  | 'link'
  | 'copy'
  | 'more'
  | 'star'
  | 'star-fill'
  | 'check'
  | 'refresh'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'home-grid'
  | 'folder'
  | 'folder-up'
  | 'list-collapse'
  | 'monitor'
  | 'terminal'
  | 'crosshair'
  | 'file-text'
  | 'ai-chat'
  | 'sync'
  | 'transfer'
  | 'link-2'
  | 'settings'
  | 'history'
  | 'send'
  | 'stop'
  | 'play'
  | 'play-selection'
  | 'play-statement'
  | 'play-all'
  | 'query-plan'
  | 'paste'
  | 'select-all'
  | 'clear'
  | 'eye'
  | 'eye-off'
  | 'grip'
  | 'docker'
  | 'alert-triangle'
  | 'alert-circle'
  | 'info'
  | 'help-circle'
  | 'split-h'
  | 'split-v'
  | 'lock'
  | 'database'
  | 'table'
  | 'server'
  | 'schema'
  | 'view'
  | 'columns'
  | 'key'
  | 'index'
  | 'filter'
  | 'sql'

export type AppIconSizeToken = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'hero'

const SIZE_TOKENS = new Set<string>(['xs', 'sm', 'md', 'lg', 'xl', '2xl', 'hero'])

/** Map legacy pixel sizes to tokens for consistent call sites. */
const PIXEL_TO_TOKEN: Record<number, AppIconSizeToken> = {
  10: 'xs',
  11: 'xs',
  12: 'xs',
  13: 'sm',
  14: 'sm',
  15: 'md',
  16: 'md',
  17: 'lg',
  18: 'lg',
  19: 'xl',
  20: 'xl',
  21: 'xl',
  22: 'xl',
  24: '2xl',
  26: '2xl',
  28: '2xl',
  32: '2xl',
  40: 'hero',
  48: 'hero',
}

const props = withDefaults(
  defineProps<{
    name: AppIconName
    /** Semantic token, number (px), or CSS length. Omit to inherit from parent. */
    size?: AppIconSizeToken | number | string
    /** SVG stroke width in viewBox units (scales with icon). Default uses --icon-stroke. */
    strokeWidth?: number | string
  }>(),
  {
    size: undefined,
    strokeWidth: undefined,
  },
)

function parsePixelSize(raw: number | string): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  const s = String(raw).trim()
  const m = /^(\d+(?:\.\d+)?)px?$/i.exec(s)
  if (m) return Number(m[1])
  return null
}

const resolvedToken = computed<AppIconSizeToken | 'inherit' | null>(() => {
  if (props.size == null || props.size === '') return 'inherit'
  if (typeof props.size === 'string' && SIZE_TOKENS.has(props.size)) {
    return props.size as AppIconSizeToken
  }
  const px = parsePixelSize(props.size as number | string)
  if (px != null && PIXEL_TO_TOKEN[Math.round(px)]) {
    return PIXEL_TO_TOKEN[Math.round(px)]
  }
  return null
})

const customFontSize = computed(() => {
  if (resolvedToken.value != null) return undefined
  if (props.size == null) return undefined
  if (typeof props.size === 'number') return `${props.size}px`
  const s = String(props.size).trim()
  if (!s) return undefined
  return /^\d+(\.\d+)?$/.test(s) ? `${s}px` : s
})

const dataSize = computed(() => {
  if (resolvedToken.value === 'inherit') return undefined
  return resolvedToken.value || undefined
})

const iconStyle = computed(() => {
  const style: Record<string, string> = {}
  if (customFontSize.value) style.fontSize = customFontSize.value
  if (props.strokeWidth != null && props.strokeWidth !== '') {
    style.strokeWidth = String(props.strokeWidth)
  }
  return Object.keys(style).length ? style : undefined
})
</script>

<template>
  <svg
    class="app-icon"
    :class="{ 'is-inherit': resolvedToken === 'inherit' }"
    :data-size="dataSize"
    :style="iconStyle"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <!-- close -->
    <template v-if="name === 'close'">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </template>
    <!-- plus -->
    <template v-else-if="name === 'plus'">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </template>
    <!-- search -->
    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </template>
    <!-- download -->
    <template v-else-if="name === 'download'">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </template>
    <!-- upload -->
    <template v-else-if="name === 'upload'">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </template>
    <!-- edit -->
    <template v-else-if="name === 'edit'">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </template>
    <!-- delete / trash -->
    <template v-else-if="name === 'delete' || name === 'trash'">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M9 6V4h6v2" />
    </template>
    <!-- link -->
    <template v-else-if="name === 'link'">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </template>
    <!-- copy -->
    <template v-else-if="name === 'copy'">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </template>
    <!-- more (horizontal) -->
    <template v-else-if="name === 'more'">
      <circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </template>
    <!-- star outline -->
    <template v-else-if="name === 'star'">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </template>
    <!-- star fill -->
    <template v-else-if="name === 'star-fill'">
      <polygon
        points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"
        fill="currentColor"
        stroke="none"
      />
    </template>
    <!-- check -->
    <template v-else-if="name === 'check'">
      <polyline points="20 6 9 17 4 12" />
    </template>
    <!-- refresh -->
    <template v-else-if="name === 'refresh'">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </template>
    <!-- chevrons -->
    <template v-else-if="name === 'chevron-right'">
      <polyline points="9 18 15 12 9 6" />
    </template>
    <template v-else-if="name === 'chevron-left'">
      <polyline points="15 18 9 12 15 6" />
    </template>
    <template v-else-if="name === 'chevron-down'">
      <polyline points="6 9 12 15 18 9" />
    </template>
    <template v-else-if="name === 'chevron-up'">
      <polyline points="18 15 12 9 6 15" />
    </template>
    <!-- home grid (sessions) -->
    <template v-else-if="name === 'home-grid'">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </template>
    <!-- folder -->
    <template v-else-if="name === 'folder'">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </template>
    <!-- folder upload -->
    <template v-else-if="name === 'folder-up'">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
      <path d="M12 17v-6m-3 3 3-3 3 3" />
    </template>
    <!-- list-collapse: fold tree branches (keep current path only) -->
    <template v-else-if="name === 'list-collapse'">
      <path d="m7 10 2.5-2.5L12 10" />
      <path d="m7 14 2.5 2.5L12 14" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="13" y1="12" x2="21" y2="12" />
      <line x1="13" y1="18" x2="21" y2="18" />
    </template>
    <!-- monitor -->
    <template v-else-if="name === 'monitor'">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </template>
    <!-- terminal / batch -->
    <template v-else-if="name === 'terminal'">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </template>
    <!-- crosshair / FPS reticle — one-shot locate -->
    <template v-else-if="name === 'crosshair'">
      <circle cx="12" cy="12" r="8" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </template>
    <!-- file-text / snippets -->
    <template v-else-if="name === 'file-text'">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </template>
    <!-- ai chat -->
    <template v-else-if="name === 'ai-chat'">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      <path d="M12 7l1 2.5L15.5 10l-2.5 1L12 13.5 11 11l-2.5-1L11 9.5z" />
    </template>
    <!-- sync both ways -->
    <template v-else-if="name === 'sync'">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l5.64 4.36A9 9 0 0 0 20.49 15" />
    </template>
    <!-- transfer -->
    <template v-else-if="name === 'transfer'">
      <path d="M7 7h11l-3-3M17 17H6l3 3" />
      <path d="m18 7-3 3M6 17l3-3" />
    </template>
    <!-- link-2 (follow path) -->
    <template v-else-if="name === 'link-2'">
      <path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.2 1.1" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.2-1.1" />
    </template>
    <!-- settings gear -->
    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </template>
    <!-- history -->
    <template v-else-if="name === 'history'">
      <path d="M3 3v5h5" />
      <path d="M3.05 13A9 9 0 1 0 5.64 6.64L3 8" />
      <path d="M12 7v5l3 2" />
    </template>
    <!-- send -->
    <template v-else-if="name === 'send'">
      <path d="M22 2L11 13" />
      <path d="M22 2l-7 20-4-9-9-4 20-7z" />
    </template>
    <!-- stop square -->
    <template v-else-if="name === 'stop'">
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </template>
    <!-- play -->
    <template v-else-if="name === 'play'">
      <polygon points="6 4 20 12 6 20 6 4" />
    </template>
    <!-- execute selected SQL: selection frame + play -->
    <template v-else-if="name === 'play-selection'">
      <path d="M3 8V4a1 1 0 0 1 1-1h4" />
      <path d="M16 3h4a1 1 0 0 1 1 1v4" />
      <path d="M21 16v4a1 1 0 0 1-1 1h-4" />
      <path d="M8 21H4a1 1 0 0 1-1-1v-4" />
      <polygon points="9 7.5 17 12 9 16.5 9 7.5" />
    </template>
    <!-- execute current statement: play + current-line marker -->
    <template v-else-if="name === 'play-statement'">
      <polygon points="5 5 16 12 5 19 5 5" />
      <line x1="19" y1="6" x2="19" y2="18" />
    </template>
    <!-- execute all SQL: double play -->
    <template v-else-if="name === 'play-all'">
      <polygon points="3 5 12 12 3 19 3 5" />
      <polygon points="12 5 21 12 12 19 12 5" />
    </template>
    <!-- query execution plan: connected operator nodes -->
    <template v-else-if="name === 'query-plan'">
      <rect x="3" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="16" width="7" height="5" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
      <path d="M6.5 8v4h11v4" />
      <path d="M6.5 12v4" />
    </template>
    <!-- paste -->
    <template v-else-if="name === 'paste'">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" />
    </template>
    <!-- select-all -->
    <template v-else-if="name === 'select-all'">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </template>
    <!-- clear / ban -->
    <template v-else-if="name === 'clear'">
      <circle cx="12" cy="12" r="10" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </template>
    <!-- eye -->
    <template v-else-if="name === 'eye'">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </template>
    <template v-else-if="name === 'eye-off'">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </template>
    <!-- grip (6 dots) -->
    <template v-else-if="name === 'grip'">
      <circle cx="9" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1.2" fill="currentColor" stroke="none" />
    </template>
    <!-- docker (stacked containers + whale silhouette) -->
    <template v-else-if="name === 'docker'">
      <g fill="currentColor" stroke="none">
        <rect x="3" y="10" width="3.2" height="3.2" rx="0.45" />
        <rect x="7" y="10" width="3.2" height="3.2" rx="0.45" />
        <rect x="11" y="10" width="3.2" height="3.2" rx="0.45" />
        <rect x="15" y="10" width="3.2" height="3.2" rx="0.45" />
        <rect x="7" y="6" width="3.2" height="3.2" rx="0.45" />
        <rect x="11" y="6" width="3.2" height="3.2" rx="0.45" />
        <rect x="11" y="2" width="3.2" height="3.2" rx="0.45" />
        <path d="M2 14.2h16.1c.2-1.15.9-2.05 2.05-2.55.55-.24 1.2-.3 1.85-.16-.25 1.12-.83 1.96-1.73 2.52-.42 4.45-3.76 6.75-8.92 6.75H8.7C5.15 20.76 2.55 18.42 2 14.2Z" />
      </g>
      <circle cx="5.15" cy="16.3" r="0.7" fill="var(--bg-primary, #fff)" stroke="none" />
      <path d="M18.15 11.2c.25-1.15 1.05-1.95 2.25-2.25" />
    </template>
    <!-- alert triangle -->
    <template v-else-if="name === 'alert-triangle'">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </template>
    <!-- alert circle (error) -->
    <template v-else-if="name === 'alert-circle'">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </template>
    <!-- info -->
    <template v-else-if="name === 'info'">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </template>
    <!-- help-circle -->
    <template v-else-if="name === 'help-circle'">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </template>
    <!-- split horizontal (stacked panes) -->
    <template v-else-if="name === 'split-h'">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="3" y1="12" x2="21" y2="12" />
    </template>
    <!-- split vertical (side panes) -->
    <template v-else-if="name === 'split-v'">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <line x1="12" y1="3" x2="12" y2="21" />
    </template>
    <!-- lock -->
    <template v-else-if="name === 'lock'">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </template>
    <!--
      Database family — Lucide official paths
      (https://github.com/lucide-icons/lucide/tree/main/icons)
      Local names may alias Lucide names (schema→layers, view→table-2, filter→funnel, sql→code, index→list).
    -->
    <!-- lucide: database -->
    <template v-else-if="name === 'database'">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5V19A9 3 0 0 0 21 19V5" />
      <path d="M3 12A9 3 0 0 0 21 12" />
    </template>
    <!-- lucide: table -->
    <template v-else-if="name === 'table'">
      <path d="M12 3v18" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
    </template>
    <!-- lucide: server -->
    <template v-else-if="name === 'server'">
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <line x1="6" x2="6.01" y1="6" y2="6" />
      <line x1="6" x2="6.01" y1="18" y2="18" />
    </template>
    <!-- lucide: layers (schema / catalog) -->
    <template v-else-if="name === 'schema'">
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z" />
      <path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12" />
      <path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17" />
    </template>
    <!-- lucide: table-2 (SQL view) -->
    <template v-else-if="name === 'view'">
      <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18" />
    </template>
    <!-- lucide: columns-3 -->
    <template v-else-if="name === 'columns'">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="M15 3v18" />
    </template>
    <!-- lucide: key -->
    <template v-else-if="name === 'key'">
      <path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4" />
      <path d="m21 2-9.6 9.6" />
      <circle cx="7.5" cy="15.5" r="5.5" />
    </template>
    <!-- lucide: list (index) -->
    <template v-else-if="name === 'index'">
      <path d="M3 5h.01" />
      <path d="M3 12h.01" />
      <path d="M3 19h.01" />
      <path d="M8 5h13" />
      <path d="M8 12h13" />
      <path d="M8 19h13" />
    </template>
    <!-- lucide: funnel (filter; Lucide renamed filter → funnel) -->
    <template v-else-if="name === 'filter'">
      <path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z" />
    </template>
    <!-- lucide: code (SQL) -->
    <template v-else-if="name === 'sql'">
      <path d="m16 18 6-6-6-6" />
      <path d="m8 6-6 6 6 6" />
    </template>
  </svg>
</template>

<style scoped>
.app-icon {
  display: block;
  flex-shrink: 0;
  /* 1em box → scales with font-size / CSS tokens / --ui-scale */
  width: 1em;
  height: 1em;
  font-size: var(--icon-md);
  stroke-width: var(--icon-stroke, 1.8);
  overflow: visible;
  shape-rendering: geometricPrecision;
}

/* size omitted: keep --icon-md unless a parent rule (e.g. .ui-icon-btn) overrides */

.app-icon[data-size='xs'] {
  font-size: var(--icon-xs);
}

.app-icon[data-size='sm'] {
  font-size: var(--icon-sm);
}

.app-icon[data-size='md'] {
  font-size: var(--icon-md);
}

.app-icon[data-size='lg'] {
  font-size: var(--icon-lg);
}

.app-icon[data-size='xl'] {
  font-size: var(--icon-xl);
}

.app-icon[data-size='2xl'] {
  font-size: var(--icon-2xl);
}

.app-icon[data-size='hero'] {
  font-size: var(--icon-hero);
}
</style>
