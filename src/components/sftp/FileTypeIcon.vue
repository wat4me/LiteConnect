<script setup lang="ts">
import { computed } from 'vue'
import AppIcon, { type AppIconName } from '../icons/AppIcon.vue'

const iconNames = {
  folder: 'folder',
  link: 'link',
  archive: 'file-archive',
  image: 'image',
  code: 'file-code',
  config: 'file-cog',
  text: 'file-text',
  database: 'database',
  file: 'file',
} as const satisfies Record<string, AppIconName>

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
  <AppIcon
    :name="iconNames[iconKind]"
    class="file-type-icon"
    :class="`is-${iconKind}`"
  />
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

.is-folder { color: var(--file-folder); }
.is-link { color: var(--accent); }
.is-archive { color: var(--file-archive); }
.is-image { color: var(--file-image); }
.is-code { color: var(--file-code); }
.is-config, .is-text { color: var(--text-secondary); }
.is-database { color: var(--file-database); }
</style>
