<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiImageAttachment } from '@shared/types/ai'
import AppIcon from '../icons/AppIcon.vue'
defineOptions({ inheritAttrs: false })

const props = defineProps<{ images: AiImageAttachment[]; removable?: boolean; disabled?: boolean }>()
const emit = defineEmits<{ remove: [index: number] }>()
const { t } = useI18n()
const preview = ref<AiImageAttachment | null>(null)
const dialog = ref<HTMLDialogElement | null>(null)
async function openPreview(image: AiImageAttachment) {
  if (!image.dataUrl || image.missing) return
  preview.value = image
  await nextTick()
  dialog.value?.showModal()
}
function closePreview() { dialog.value?.close(); preview.value = null }
watch(() => props.images, () => { if (preview.value && !props.images.includes(preview.value)) closePreview() })
</script>

<template>
  <div v-bind="$attrs" class="ai-image-strip" :aria-label="t('ai.imageAttachments')">
    <div v-for="(image, index) in images" :key="`${image.id}-${index}`" class="ai-image-item">
      <button type="button" class="ai-image-thumbnail" :disabled="!image.dataUrl || image.missing" :title="image.name" :aria-label="t('ai.previewImage', { name: image.name })" @click="openPreview(image)">
        <img v-if="image.dataUrl && !image.missing" :src="image.dataUrl" :alt="image.name" />
        <span v-else>{{ t('ai.imageMissing') }}</span>
      </button>
      <button v-if="removable" type="button" class="ai-image-remove" :disabled="disabled" :aria-label="t('ai.removeImage', { name: image.name })" :title="t('ai.removeImage', { name: image.name })" @click="emit('remove', index)"><AppIcon name="close" size="xs" /></button>
    </div>
  </div>
  <Teleport to="body">
    <dialog ref="dialog" class="ai-image-dialog" :aria-label="t('ai.imagePreview')" @close="preview = null" @click="($event.target === dialog) && closePreview()">
      <div v-if="preview" class="ai-image-preview">
        <div class="ai-image-preview-head"><span>{{ preview.name }}</span><button type="button" class="ui-icon-btn" :aria-label="t('common.close')" @click="closePreview"><AppIcon name="close" /></button></div>
        <img :src="preview.dataUrl" :alt="preview.name" />
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.ai-image-strip { display: flex; gap: 8px; flex-wrap: wrap; padding: 4px 0; flex-shrink: 0; }
.ai-image-item { position: relative; }
.ai-image-thumbnail { width: 64px; height: 64px; padding: 2px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); color: var(--text-secondary); cursor: pointer; overflow: hidden; }
.ai-image-thumbnail img { width: 100%; height: 100%; object-fit: contain; display: block; }
.ai-image-thumbnail span { font-size: 11px; }
.ai-image-thumbnail:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ai-image-remove { position: absolute; top: -4px; right: -4px; width: 20px; height: 20px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--border-color); border-radius: 50%; background: var(--bg-primary); color: var(--text-secondary); cursor: pointer; }
.ai-image-remove:hover { color: var(--danger); }
.ai-image-dialog { padding: 16px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-primary); color: var(--text-primary); max-width: 90vw; max-height: 90vh; }
.ai-image-dialog::backdrop { background: rgb(0 0 0 / 55%); }
.ai-image-preview-head { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 8px; }
.ai-image-preview-head span { overflow-wrap: anywhere; }
.ai-image-preview img { display: block; max-width: min(80vw, 1200px); max-height: 75vh; object-fit: contain; }
</style>
