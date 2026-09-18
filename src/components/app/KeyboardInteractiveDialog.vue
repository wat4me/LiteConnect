<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { KeyboardInteractivePrompt } from '@/env.d'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps<{
  data: KeyboardInteractivePrompt | null
}>()

const emit = defineEmits<{
  (e: 'submit', answers: string[]): void
  (e: 'cancel'): void
}>()

const { t } = useI18n()
const answers = reactive<string[]>([])

watch(
  () => props.data?.requestId,
  () => {
    answers.splice(0, answers.length)
    for (const _p of props.data?.prompts || []) answers.push('')
  },
  { immediate: true },
)

const title = computed(() =>
  props.data?.role === 'jump' ? t('dialog.kbTitleJump') : t('dialog.kbTitle'),
)

function submit() {
  emit('submit', answers.map((a) => a || ''))
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    submit()
  }
}
</script>

<template>
  <div v-if="data" class="kb-mask" @keydown="onKeydown">
    <div class="kb-card" role="dialog" aria-modal="true">
      <div class="kb-head">
        <AppIcon name="lock" size="md" />
        <h3>{{ title }}</h3>
      </div>
      <p v-if="data.name || data.instructions" class="kb-intro">
        {{ data.name }}
        <template v-if="data.instructions"><br />{{ data.instructions }}</template>
      </p>
      <p class="kb-hint">{{ t('dialog.kbHint') }}</p>
      <div v-for="(p, i) in data.prompts" :key="i" class="kb-field">
        <label>{{ p.prompt || t('dialog.kbPromptFallback', { n: i + 1 }) }}</label>
        <input
          v-model="answers[i]"
          class="ui-input"
          :type="p.echo ? 'text' : 'password'"
          autocomplete="one-time-code"
        />
      </div>
      <div class="kb-actions">
        <button type="button" class="ui-btn" @click="emit('cancel')">{{ t('common.cancel') }}</button>
        <button type="button" class="ui-btn ui-btn-primary" @click="submit">{{ t('common.ok') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.kb-mask {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}
.kb-card {
  width: min(420px, 92vw);
  padding: 18px 20px 16px;
  border-radius: 10px;
  background: var(--bg-elevated, #161b22);
  border: 1px solid var(--border, #30363d);
  color: var(--text, #e6edf3);
}
.kb-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.kb-head h3 {
  margin: 0;
  font-size: 15px;
}
.kb-intro,
.kb-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: var(--text-secondary, #8b949e);
  white-space: pre-wrap;
}
.kb-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 10px;
}
.kb-field label {
  font-size: 12px;
}
.kb-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}
</style>
