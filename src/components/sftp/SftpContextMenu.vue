<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileEntry } from '../../env.d.ts'
import AppIcon from '../icons/AppIcon.vue'
import { fitFixedElement } from '../../utils/popupPosition'
import { useOutsideDismiss } from '../../composables/useOutsideDismiss'

const props = defineProps<{
  visible: boolean
  x: number
  y: number
  entry: FileEntry | null
  canEdit: (name: string) => boolean
  isArchive: (name: string) => boolean
}>()

const emit = defineEmits<{
  (e: 'open', entry: FileEntry): void
  (e: 'download', entry: FileEntry): void
  (e: 'download-to', entry: FileEntry): void
  (e: 'download-dir', entry: FileEntry): void
  (e: 'extract', entry: FileEntry): void
  (e: 'edit', entry: FileEntry): void
  (e: 'rename', entry: FileEntry): void
  (e: 'properties', entry: FileEntry): void
  (e: 'delete', entry: FileEntry): void
  (e: 'dismiss'): void
}>()

const { t } = useI18n()
const menuRef = ref<HTMLElement | null>(null)
const left = ref(0)
const top = ref(0)
const isOpen = computed(() => props.visible && !!props.entry)

useOutsideDismiss(
  isOpen,
  () => emit('dismiss'),
  () => [menuRef.value],
)

async function reposition() {
  if (!props.visible) return
  left.value = props.x
  top.value = props.y
  await nextTick()
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  const el = menuRef.value
  if (!el || !props.visible) return
  const pos = fitFixedElement(el, { x: props.x, y: props.y })
  left.value = pos.left
  top.value = pos.top
}

watch(
  () => [props.visible, props.x, props.y, props.entry?.path] as const,
  ([visible]) => {
    if (visible) void reposition()
  },
  { immediate: true },
)
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible && entry"
      ref="menuRef"
      class="context-menu"
      :style="{ left: left + 'px', top: top + 'px' }"
      @click.stop
    >
      <button
        v-if="entry.isDirectory"
        type="button"
        class="context-menu-item"
        @click="emit('open', entry)"
      >
        <AppIcon name="folder" :size="12" />
        <span>{{ t('sftp.open') }}</span>
      </button>
      <button
        v-if="!entry.isDirectory"
        type="button"
        class="context-menu-item"
        @click="emit('download', entry)"
      >
        <AppIcon name="download" :size="12" />
        <span>{{ t('sftp.download') }}</span>
      </button>
      <button
        v-if="!entry.isDirectory"
        type="button"
        class="context-menu-item"
        @click="emit('download-to', entry)"
      >
        <AppIcon name="folder" :size="12" />
        <span>{{ t('sftp.downloadTo') }}</span>
      </button>
      <button
        v-if="!entry.isDirectory && isArchive(entry.name)"
        type="button"
        class="context-menu-item"
        @click="emit('extract', entry)"
      >
        <AppIcon name="folder-up" :size="12" />
        <span>{{ t('sftp.extractRemote') }}</span>
      </button>
      <button
        v-if="entry.isDirectory"
        type="button"
        class="context-menu-item"
        @click="emit('download-dir', entry)"
      >
        <AppIcon name="download" :size="12" />
        <span>{{ t('sftp.downloadFolder') }}</span>
      </button>
      <button
        v-if="!entry.isDirectory && canEdit(entry.name)"
        type="button"
        class="context-menu-item"
        @click="emit('edit', entry)"
      >
        <AppIcon name="edit" :size="12" />
        <span>{{ t('sftp.edit') }}</span>
      </button>
      <button type="button" class="context-menu-item" @click="emit('rename', entry)">
        <AppIcon name="edit" :size="12" />
        <span>{{ t('sftp.rename') }}</span>
      </button>
      <button type="button" class="context-menu-item" @click="emit('properties', entry)">
        <AppIcon name="settings" :size="12" />
        <span>{{ t('sftp.properties') }}</span>
      </button>
      <button type="button" class="context-menu-item danger" @click="emit('delete', entry)">
        <AppIcon name="delete" :size="12" />
        <span>{{ t('sftp.delete') }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.context-menu {
  position: fixed;
  z-index: 10000;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  padding: 4px 0;
  min-width: 140px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
}

.context-menu-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.context-menu-item svg {
  flex-shrink: 0;
  opacity: 0.85;
}

.context-menu-item.danger {
  color: var(--danger);
}

.context-menu-item:hover {
  background: var(--accent-bg);
  color: var(--accent);
}
</style>
