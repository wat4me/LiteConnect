<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  name: string
  isDirectory?: boolean
  isSymlink?: boolean
}>()

const iconKind = computed(() => {
  if (props.isDirectory) return 'folder'
  if (props.isSymlink) return 'link'

  const lower = props.name.toLowerCase()
  if (/\.(zip|7z|rar|tar|tgz|gz|bz2|xz)$/.test(lower)) return 'archive'
  if (/\.(png|jpe?g|gif|webp|svg|ico|bmp|avif)$/.test(lower)) return 'image'
  if (/\.(js|mjs|cjs|ts|tsx|jsx|vue|py|rb|go|rs|java|kt|c|cc|cpp|h|hpp|cs|php|sh|bash|zsh|ps1)$/.test(lower)) return 'code'
  if (/\.(json|ya?ml|toml|ini|conf|cfg|env|xml|properties)$/.test(lower)) return 'config'
  if (/\.(md|markdown|mdx|rst|txt|log)$/.test(lower)) return 'text'
  if (/\.(sql|db|sqlite|sqlite3)$/.test(lower)) return 'database'
  return 'file'
})
</script>

<template>
  <svg
    class="file-type-icon"
    :class="`is-${iconKind}`"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <template v-if="iconKind === 'folder'">
      <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H9l2 2.5h7.5A2.5 2.5 0 0 1 21 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z" />
    </template>
    <template v-else-if="iconKind === 'link'">
      <path d="M10 13a5 5 0 0 0 7.54.54l2-2a5 5 0 0 0-7.07-7.07l-1.15 1.15" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-2 2a5 5 0 0 0 7.07 7.07l1.14-1.14" />
    </template>
    <template v-else-if="iconKind === 'archive'">
      <path d="M6 3h12v18H6z" />
      <path d="M10 3v4h4V3M10 11h4M10 15h4" />
    </template>
    <template v-else-if="iconKind === 'image'">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="8.5" cy="9" r="1.5" />
      <path d="m21 15-4.5-4.5L7 20" />
    </template>
    <template v-else-if="iconKind === 'code'">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M9 13l-2 2 2 2M15 13l2 2-2 2" />
    </template>
    <template v-else-if="iconKind === 'config'">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </template>
    <template v-else-if="iconKind === 'database'">
      <ellipse cx="12" cy="5" rx="7" ry="3" />
      <path d="M5 5v7c0 1.66 3.13 3 7 3s7-1.34 7-3V5" />
      <path d="M5 12v7c0 1.66 3.13 3 7 3s7-1.34 7-3v-7" />
    </template>
    <template v-else-if="iconKind === 'text'">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6M8 13h8M8 17h8" />
    </template>
    <template v-else>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </template>
  </svg>
</template>

<style scoped>
.file-type-icon {
  display: block;
  /* Scale with SFTP list/tree density; falls back when used outside sidebar */
  width: var(--sftp-icon-size, 1.125rem);
  height: var(--sftp-icon-size, 1.125rem);
  min-width: var(--sftp-icon-size, 1.125rem);
  min-height: var(--sftp-icon-size, 1.125rem);
  flex-shrink: 0;
  color: var(--text-secondary);
  /* Keep paths crisp under CSS scaling / high-DPI */
  shape-rendering: geometricPrecision;
}

.is-folder { color: #d6a84f; }
.is-link { color: #58a6ff; }
.is-archive { color: #c792ea; }
.is-image { color: #56b6c2; }
.is-code { color: #61afef; }
.is-config { color: #abb2bf; }
.is-text { color: #9aa5b1; }
.is-database { color: #e5c07b; }
</style>
