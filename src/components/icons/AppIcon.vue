<script setup lang="ts">
/**
 * Unified stroke icons (Feather/Lucide style, viewBox 0 0 24 24).
 * Imported Lucide SVG sources and pinned revision: docs/ICONS.md.
 * Upstream ISC / Feather MIT notices: public/third-party/Lucide-LICENSE.txt.
 *
 * Sizing:
 * - Prefer semantic tokens: xs | sm | md | lg | xl | 2xl | hero
 * - Tokens map to CSS vars (--icon-*) which scale with --ui-scale
 * - Number / px string still accepted for one-off sizes
 * - Omit size to inherit from parent (e.g. .ui-icon-btn)
 */
import { computed } from 'vue'

export type AppIconName =
  | 'shield'
  | 'lock-open'
  | 'split-left'
  | 'split-right'
  | 'split-top'
  | 'split-bottom'
  | 'split-exit-v'
  | 'background-tasks'
  | 'file'
  | 'file-cog'
  | 'file-code'
  | 'file-archive'
  | 'bell'
  | 'calendar-clock'
  | 'models'
  | 'plug'
  | 'unplug'
  | 'broadcast'
  | 'terminal-sync'
  | 'terminal-history'
  | 'batch-command'
  | 'file-terminal'
  | 'connection-test'
  | 'monitor-activity'
  | 'skip'
  | 'close'
  | 'plus'
  | 'minus'
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
  | 'circle-check'
  | 'refresh'
  | 'chevron-right'
  | 'chevron-down'
  | 'arrow-down'
  | 'chevron-up'
  | 'chevron-left'
  | 'home-grid'
  | 'folder'
  | 'folder-sync'
  | 'folder-up'
  | 'list-collapse'
  | 'list'
  | 'locate'
  | 'pin'
  | 'pin-fill'
  | 'monitor'
  | 'activity'
  | 'terminal'
  | 'external-link'
  | 'crosshair'
  | 'file-text'
  | 'image'
  | 'file-diff'
  | 'ai-chat'
  | 'sync'
  | 'transfer'
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
  | 'split-exit'
  | 'swap'
  | 'maximize'
  | 'restore'
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
      <!-- Lucide: x; source and license: docs/ICONS.md -->
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </template>
    <!-- plus -->
    <template v-else-if="name === 'plus'">
      <!-- Lucide: plus; source and license: docs/ICONS.md -->
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </template>
    <!-- minus -->
    <template v-else-if="name === 'minus'">
      <!-- Lucide: minus; source and license: docs/ICONS.md -->
      <path d="M5 12h14" />
    </template>
    <!-- search -->
    <template v-else-if="name === 'search'">
      <!-- Lucide: search; source and license: docs/ICONS.md -->
      <path d="m21 21-4.34-4.34" />
      <circle cx="11" cy="11" r="8" />
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
      <!-- Lucide: pencil; source and license: docs/ICONS.md -->
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </template>
    <!-- delete / trash -->
    <template v-else-if="name === 'delete' || name === 'trash'">
      <!-- Lucide: trash; source and license: docs/ICONS.md -->
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </template>
    <!-- link -->
    <template v-else-if="name === 'link'">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </template>
    <!-- copy -->
    <template v-else-if="name === 'copy'">
      <!-- Lucide: copy; source and license: docs/ICONS.md -->
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
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
    <!-- verify / test -->
    <template v-else-if="name === 'circle-check'">
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16 9" />
    </template>
    <!-- refresh -->
    <template v-else-if="name === 'refresh'">
      <!-- Lucide: rotate-cw; source and license: docs/ICONS.md -->
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </template>
    <!-- chevrons -->
    <template v-else-if="name === 'chevron-right'">
      <!-- Lucide: chevron-right; source and license: docs/ICONS.md -->
      <path d="m9 18 6-6-6-6" />
    </template>
    <template v-else-if="name === 'chevron-left'">
      <!-- Lucide: chevron-left; source and license: docs/ICONS.md -->
      <path d="m15 18-6-6 6-6" />
    </template>
    <template v-else-if="name === 'chevron-down'">
      <!-- Lucide: chevron-down; source and license: docs/ICONS.md -->
      <path d="m6 9 6 6 6-6" />
    </template>
    <!-- Downward navigation, including returning to the latest chat output. -->
    <template v-else-if="name === 'arrow-down'">
      <path d="M12 4v16m-7-7 7 7 7-7" />
    </template>
    <template v-else-if="name === 'chevron-up'">
      <!-- Lucide: chevron-up; source and license: docs/ICONS.md -->
      <path d="m18 15-6-6-6 6" />
    </template>
    <!-- home grid (sessions) -->
    <template v-else-if="name === 'home-grid'">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </template>
    <!-- File differences: a document with added and removed lines. -->
    <template v-else-if="name === 'file-diff'">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <path d="M9 13h6m-3-3v6m-3 3h6" />
    </template>
    <!-- folder -->
    <template v-else-if="name === 'folder'">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </template>
    <!-- folder-sync (Lucide): directory updates with the terminal path -->
    <template v-else-if="name === 'folder-sync'">
      <path d="M9 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v.5" />
      <path d="M12 10v4h4" />
      <path d="m12 14 1.535-1.605a5 5 0 0 1 8 1.5M22 22v-4h-4" />
      <path d="m22 18-1.535 1.605a5 5 0 0 1-8-1.5" />
    </template>
    <!-- folder upload -->
    <template v-else-if="name === 'folder-up'">
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.5h7.5A2.5 2.5 0 0 1 21 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
      <path d="M12 17v-6m-3 3 3-3 3 3" />
    </template>
    <template v-else-if="name === 'list'">
      <line x1="8" y1="6" x2="21" y2="6" />
      <line x1="8" y1="12" x2="21" y2="12" />
      <line x1="8" y1="18" x2="21" y2="18" />
      <line x1="3" y1="6" x2="4" y2="6" />
      <line x1="3" y1="12" x2="4" y2="12" />
      <line x1="3" y1="18" x2="4" y2="18" />
    </template>
    <!-- list-collapse: arrows folding toward the center line -->
    <template v-else-if="name === 'list-collapse'">
      <polyline points="8 5 12 9 16 5" />
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="8 19 12 15 16 19" />
    </template>
    <!-- locate: circle with a cross through the center -->
    <template v-else-if="name === 'locate'">
      <circle cx="12" cy="12" r="6" />
      <line x1="12" y1="2" x2="12" y2="22" />
      <line x1="2" y1="12" x2="22" y2="12" />
    </template>
    <!-- pin outline -->
    <template v-else-if="name === 'pin'">
      <path d="M8 3h8v6l2.5 3h-13L8 9z" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </template>
    <!-- pin filled -->
    <template v-else-if="name === 'pin-fill'">
      <path d="M8 3h8v6l2.5 3h-13L8 9z" fill="currentColor" stroke="none" />
      <line x1="12" y1="12" x2="12" y2="21" />
    </template>
    <!-- monitor -->
    <template v-else-if="name === 'monitor'">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </template>
    <!-- activity / resource usage -->
    <template v-else-if="name === 'monitor-activity'">
      <!-- Custom: a resource waveform inside a monitor. -->
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8m-4-4v4M5 10h3l2-4 3 8 2-4h4" />
    </template>
    <template v-else-if="name === 'activity'">
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </template>
    <!-- terminal / batch -->
    <template v-else-if="name === 'terminal'">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </template>
    <!-- open in a new window -->
    <template v-else-if="name === 'external-link'">
      <path d="M13 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <path d="M15 3h6v6" />
      <path d="m10 14 11-11" />
    </template>
    <!-- crosshair / FPS reticle — one-shot locate -->
    <template v-else-if="name === 'crosshair'">
      <circle cx="12" cy="12" r="8" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </template>
    <template v-else-if="name === 'image'">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </template>
    <!-- file-text / snippets -->
    <template v-else-if="name === 'file-text'">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
    </template>
    <!-- ai chat (Lucide sparkles) -->
    <template v-else-if="name === 'ai-chat'">
      <path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z" />
      <path d="M20 2v4" />
      <path d="M22 4h-4" />
      <circle cx="4" cy="20" r="2" />
    </template>
    <!-- sync both ways -->
    <template v-else-if="name === 'sync'">
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l5.64 4.36A9 9 0 0 0 20.49 15" />
    </template>
    <!-- transfer: upload and download side by side -->
    <template v-else-if="name === 'transfer'">
      <line x1="7" y1="19" x2="7" y2="6" />
      <polyline points="4 9 7 5 10 9" />
      <line x1="17" y1="5" x2="17" y2="18" />
      <polyline points="14 15 17 19 20 15" />
    </template>
    <!-- settings gear -->
    <template v-else-if="name === 'settings'">
      <!-- Lucide: settings; source and license: docs/ICONS.md -->
      <path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915" />
      <circle cx="12" cy="12" r="3" />
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
    <template v-else-if="name === 'bell'">
      <!-- Lucide: bell; source and license: docs/ICONS.md -->
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
    </template>
    <template v-else-if="name === 'calendar-clock'">
      <!-- Lucide: calendar-clock; source and license: docs/ICONS.md -->
      <path d="M16 14v2.2l1.6 1" />
      <path d="M16 2v3" />
      <path d="M21 7.338V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h2.338" />
      <path d="M3 9h5.859" />
      <path d="M8 2v3" />
      <circle cx="16" cy="16" r="6" />
    </template>
    <template v-else-if="name === 'models'">
      <!-- Lucide: boxes; source and license: docs/ICONS.md -->
      <path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z" />
      <path d="m7 16.5-4.74-2.85" />
      <path d="m7 16.5 5-3" />
      <path d="M7 16.5v5.17" />
      <path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z" />
      <path d="m17 16.5-5-3" />
      <path d="m17 16.5 4.74-2.85" />
      <path d="M17 16.5v5.17" />
      <path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z" />
      <path d="M12 8 7.26 5.15" />
      <path d="m12 8 4.74-2.85" />
      <path d="M12 13.5V8" />
    </template>
    <template v-else-if="name === 'plug'">
      <!-- Lucide: plug; source and license: docs/ICONS.md -->
      <path d="M12 22v-5" />
      <path d="M15 8V2" />
      <path d="M17 8a1 1 0 0 1 1 1v4a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1z" />
      <path d="M9 8V2" />
    </template>
    <template v-else-if="name === 'unplug'">
      <!-- Lucide: unplug; source and license: docs/ICONS.md -->
      <path d="m19 5 3-3" />
      <path d="m2 22 3-3" />
      <path d="M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" />
      <path d="M7.5 13.5 10 11" />
      <path d="M10.5 16.5 13 14" />
      <path d="m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" />
    </template>
    <template v-else-if="name === 'terminal-sync'">
      <!-- Custom: overlapping terminal windows for synchronized input. -->
      <path d="M8 5V4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1h-1" />
      <rect x="3" y="8" width="13" height="13" rx="1" />
      <path d="m6 12 3 3-3 3m5 0h2" />
    </template>
    <template v-else-if="name === 'terminal-history'">
      <!-- Custom: terminal output with a history clock. -->
      <path d="M11 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5" />
      <path d="m6 8 3 3-3 3m5 0h2" />
      <circle cx="18" cy="18" r="4" />
      <path d="M18 16v2l1.5 1" />
    </template>
    <template v-else-if="name === 'batch-command'">
      <!-- Custom: one command fans out to multiple targets. -->
      <path d="m2 8 3 4-3 4m5 0h2M10 12h3m0-7v14m0-14h4m-4 14h4" />
      <rect x="17" y="2" width="5" height="6" rx="1" />
      <rect x="17" y="16" width="5" height="6" rx="1" />
    </template>
    <template v-else-if="name === 'file-terminal'">
      <!-- Custom: a reusable command document. -->
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6m-12 4 3 3-3 3m5 0h3" />
    </template>
    <template v-else-if="name === 'connection-test'">
      <!-- Custom: a plug and diagnostic pulse; not a success indicator. -->
      <path d="M5 3v4m4-4v4M3 7h8v4a4 4 0 0 1-8 0V7m4 8v6m6-7h2l2-5 2 10 2-5h2" />
    </template>
    <template v-else-if="name === 'broadcast'">
      <!-- Lucide: radio-tower; source and license: docs/ICONS.md -->
      <path d="M4.9 16.1C1 12.2 1 5.8 4.9 1.9" />
      <path d="M7.8 4.7a6.14 6.14 0 0 0-.8 7.5" />
      <circle cx="12" cy="9" r="2" />
      <path d="M16.2 4.8c2 2 2.26 5.11.8 7.47" />
      <path d="M19.1 1.9a9.96 9.96 0 0 1 0 14.1" />
      <path d="M9.5 18h5" />
      <path d="m8 22 4-11 4 11" />
    </template>
    <template v-else-if="name === 'skip'">
      <!-- Lucide: circle-slash; source and license: docs/ICONS.md -->
      <circle cx="12" cy="12" r="10" />
      <line x1="9" x2="15" y1="15" y2="9" />
    </template>
    <template v-else-if="name === 'select-all'">
      <!-- Lucide: square-dashed; source and license: docs/ICONS.md -->
      <path d="M5 3a2 2 0 0 0-2 2" />
      <path d="M19 3a2 2 0 0 1 2 2" />
      <path d="M21 19a2 2 0 0 1-2 2" />
      <path d="M5 21a2 2 0 0 1-2-2" />
      <path d="M9 3h1" />
      <path d="M9 21h1" />
      <path d="M14 3h1" />
      <path d="M14 21h1" />
      <path d="M3 9v1" />
      <path d="M21 9v1" />
      <path d="M3 14v1" />
      <path d="M21 14v1" />
    </template>
    <template v-else-if="name === 'clear'">
      <!-- Lucide: eraser; source and license: docs/ICONS.md -->
      <path d="M21 21H8a2 2 0 0 1-1.42-.587l-3.994-3.999a2 2 0 0 1 0-2.828l10-10a2 2 0 0 1 2.829 0l5.999 6a2 2 0 0 1 0 2.828L12.834 21" />
      <path d="m5.082 11.09 8.828 8.828" />
    </template>
    <template v-else-if="name === 'lock-open'">
      <!-- Lucide: lock-open; source and license: docs/ICONS.md -->
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 9.9-1" />
    </template>
    <template v-else-if="name === 'split-left'">
      <!-- Lucide: panel-left; source and license: docs/ICONS.md -->
      <rect x="3" y="3" width="6" height="18" rx="2" fill="currentColor" fill-opacity=".14" stroke="none" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </template>
    <template v-else-if="name === 'split-right'">
      <!-- Lucide: panel-right; source and license: docs/ICONS.md -->
      <rect x="15" y="3" width="6" height="18" rx="2" fill="currentColor" fill-opacity=".14" stroke="none" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </template>
    <template v-else-if="name === 'split-top'">
      <!-- Lucide: panel-top; source and license: docs/ICONS.md -->
      <rect x="3" y="3" width="18" height="6" rx="2" fill="currentColor" fill-opacity=".14" stroke="none" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
    </template>
    <template v-else-if="name === 'split-bottom'">
      <!-- Lucide: panel-bottom; source and license: docs/ICONS.md -->
      <rect x="3" y="15" width="18" height="6" rx="2" fill="currentColor" fill-opacity=".14" stroke="none" />
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 15h18" />
    </template>
    <template v-else-if="name === 'split-exit-v'">
      <!-- Lucide: panel-left-close; source and license: docs/ICONS.md -->
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m16 15-3-3 3-3" />
    </template>
    <template v-else-if="name === 'background-tasks'">
      <!-- Lucide: list-todo; source and license: docs/ICONS.md -->
      <path d="M13 5h8" />
      <path d="M13 12h8" />
      <path d="M13 19h8" />
      <path d="m3 17 2 2 4-4" />
      <rect x="3" y="4" width="6" height="6" rx="1" />
    </template>
    <template v-else-if="name === 'file-cog'">
      <!-- Lucide: file-cog; source and license: docs/ICONS.md -->
      <path d="M15 8a1 1 0 0 1-1-1V2a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8z" />
      <path d="M20 8v12a2 2 0 0 1-2 2h-4.182" />
      <path d="m3.305 19.53.923-.382" />
      <path d="M4 10.592V4a2 2 0 0 1 2-2h8" />
      <path d="m4.228 16.852-.924-.383" />
      <path d="m5.852 15.228-.383-.923" />
      <path d="m5.852 20.772-.383.924" />
      <path d="m8.148 15.228.383-.923" />
      <path d="m8.53 21.696-.382-.924" />
      <path d="m9.773 16.852.922-.383" />
      <path d="m9.773 19.148.922.383" />
      <circle cx="7" cy="18" r="3" />
    </template>
    <template v-else-if="name === 'file-code'">
      <!-- Lucide: file-code; source and license: docs/ICONS.md -->
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M10 12.5 8 15l2 2.5" />
      <path d="m14 12.5 2 2.5-2 2.5" />
    </template>
    <template v-else-if="name === 'file-archive'">
      <!-- Lucide: file-archive; source and license: docs/ICONS.md -->
      <path d="M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
      <path d="M8 12v-1" />
      <path d="M8 18v-2" />
      <path d="M8 7V6" />
      <circle cx="8" cy="20" r="2" />
    </template>
    <template v-else-if="name === 'file'">
      <!-- Lucide: file; source and license: docs/ICONS.md -->
      <path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" />
      <path d="M14 2v5a1 1 0 0 0 1 1h5" />
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
    <!-- exit split layout without closing either terminal -->
    <template v-else-if="name === 'split-exit'">
      <!-- Lucide: panel-top-close; source and license: docs/ICONS.md -->
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M3 9h18" />
      <path d="m9 16 3-3 3 3" />
    </template>
    <!-- lucide: arrow-left-right -->
    <template v-else-if="name === 'swap'">
      <path d="m16 3 4 4-4 4" />
      <path d="M20 7H4" />
      <path d="m8 21-4-4 4-4" />
      <path d="M4 17h16" />
    </template>
    <!-- lucide: maximize-2 -->
    <template v-else-if="name === 'maximize'">
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </template>
    <!-- lucide: minimize-2 -->
    <template v-else-if="name === 'restore'">
      <polyline points="4 14 10 14 10 20" />
      <polyline points="20 10 14 10 14 4" />
      <line x1="14" y1="10" x2="21" y2="3" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </template>
    <template v-else-if="name === 'shield'"><path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z" /><path d="m9 12 2 2 4-4" /></template>
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
