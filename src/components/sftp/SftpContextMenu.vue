<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FileEntry } from '../../env.d.ts'
import AppIcon from '../icons/AppIcon.vue'
import { fitFixedElement } from '@/utils/shared/popupPosition'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'

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
      class="ui-menu"
      :style="{ left: left + 'px', top: top + 'px' }"
      @click.stop
    >
      <button
        v-if="entry.isDirectory"
        type="button"
        class="ui-menu-item"
        @click="emit('open', entry)"
      >
        <AppIcon name="folder" size="xs" />
        <span>{{ t('sftp.open') }}</span>
      </button>
      <button
        v-if="!entry.isDirectory"
        type="button"
        class="ui-menu-item"
        @click="emit('download', entry)"
      >
        <AppIcon name="download" size="xs" />
        <span>{{ t('sftp.download') }}</span>
      </button>
      <button
        v-if="!entry.isDirectory"
        type="button"
        class="ui-menu-item"
        @click="emit('download-to', entry)"
      >
        <AppIcon name="folder" size="xs" />
        <span>{{ t('sftp.downloadTo') }}</span>
      </button>
      <button
        v-if="!entry.isDirectory && isArchive(entry.name)"
        type="button"
        class="ui-menu-item"
        @click="emit('extract', entry)"
      >
        <AppIcon name="folder-up" size="xs" />
        <span>{{ t('sftp.extractRemote') }}</span>
      </button>
      <button
        v-if="entry.isDirectory"
        type="button"
        class="ui-menu-item"
        @click="emit('download-dir', entry)"
      >
        <AppIcon name="download" size="xs" />
        <span>{{ t('sftp.downloadFolder') }}</span>
      </button>
      <button
        v-if="!entry.isDirectory && canEdit(entry.name)"
        type="button"
        class="ui-menu-item"
        @click="emit('edit', entry)"
      >
        <AppIcon name="edit" size="xs" />
        <span>{{ t('sftp.edit') }}</span>
      </button>
      <button type="button" class="ui-menu-item" @click="emit('rename', entry)">
        <AppIcon name="edit" size="xs" />
        <span>{{ t('sftp.rename') }}</span>
      </button>
      <button type="button" class="ui-menu-item" @click="emit('properties', entry)">
        <AppIcon name="settings" size="xs" />
        <span>{{ t('sftp.properties') }}</span>
      </button>
      <button type="button" class="ui-menu-item danger" @click="emit('delete', entry)">
        <AppIcon name="delete" size="xs" />
        <span>{{ t('sftp.delete') }}</span>
      </button>
    </div>
  </Teleport>
</template>
