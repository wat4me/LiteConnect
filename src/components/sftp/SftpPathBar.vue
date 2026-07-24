<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'

const { t } = useI18n()

const props = defineProps<{
  currentPath: string
  pathInput: string
  showPathInput: boolean
}>()

const emit = defineEmits<{
  (e: 'update:pathInput', value: string): void
  (e: 'toggle'): void
  (e: 'submit'): void
  (e: 'cancel'): void
  (e: 'blur-submit'): void
}>()

const pathInputRef = ref<HTMLInputElement | null>(null)
const pathDisplayRef = ref<HTMLElement | null>(null)
let pathEditCanceling = false

const displayPath = computed(() => {
  const raw = props.currentPath || ''
  return raw.replace(/\/+$/, '') || '/'
})

const localInput = computed({
  get: () => props.pathInput,
  set: (v: string) => emit('update:pathInput', v),
})

watch(
  () => props.currentPath,
  async () => {
    await nextTick()
    if (pathDisplayRef.value) {
      pathDisplayRef.value.scrollLeft = pathDisplayRef.value.scrollWidth
    }
  },
)

watch(
  () => props.showPathInput,
  async (val) => {
    if (val) {
      pathEditCanceling = false
      await nextTick()
      pathInputRef.value?.focus()
      pathInputRef.value?.select()
    }
  },
)

function onCancel() {
  pathEditCanceling = true
  emit('cancel')
}

function onBlur() {
  if (pathEditCanceling) {
    pathEditCanceling = false
    return
  }
  emit('blur-submit')
}
</script>

<template>
  <div
    class="ui-field path-field"
    :class="{ focused: showPathInput }"
    :title="showPathInput ? undefined : (currentPath || '')"
  >
    <div
      v-if="!showPathInput"
      ref="pathDisplayRef"
      class="path-display"
      :title="displayPath"
      @click="emit('toggle')"
    >
      <span class="path-display-text">{{ displayPath }}</span>
    </div>
    <form v-else class="path-inline-form" @submit.prevent="emit('submit')">
      <input
        ref="pathInputRef"
        v-model="localInput"
        class="path-input"
        :placeholder="t('sftp.pathPlaceholder')"
        spellcheck="false"
        autocomplete="off"
        @blur="onBlur"
        @keydown.escape.prevent="onCancel"
      />
    </form>
    <button
      v-if="!showPathInput"
      type="button"
      class="ui-icon-btn ui-icon-btn-ghost path-action-btn"
      :title="t('sftp.editPath')"
      @click.stop="emit('toggle')"
    >
      <AppIcon name="edit" :size="12" />
    </button>
    <button
      v-else
      type="button"
      class="ui-icon-btn ui-icon-btn-ghost path-action-btn confirm"
      :title="t('sftp.go')"
      @mousedown.prevent
      @click="emit('submit')"
    >
      <AppIcon name="check" :size="12" />
    </button>
  </div>
</template>

<style scoped>
.path-field {
  width: 100%;
  min-width: 0;
  height: 30px;
  padding-right: 4px;
  cursor: text;
  box-sizing: border-box;
}

.path-field.focused {
  cursor: default;
}

.path-display {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
  white-space: nowrap;
  cursor: text;
}

.path-display::-webkit-scrollbar {
  display: none;
}

.path-display-text {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-primary);
  line-height: 1.2;
}

.path-inline-form {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  height: 100%;
}

.path-input {
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  border: none;
  outline: none;
  background: transparent;
  color: var(--text-primary);
  font-family: var(--font-mono, 'Cascadia Code', Consolas, monospace);
  font-size: 12px;
  line-height: 1.3;
}

.path-input::placeholder {
  color: var(--text-secondary);
}

.path-action-btn {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
}
</style>
