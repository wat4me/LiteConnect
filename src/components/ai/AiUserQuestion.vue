<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { validateAiQuestions, validateAiUserAnswer, type AiUserAnswer } from '@shared/aiQuestions'
import type { AiToolRun } from '@shared/types/ai'
const props = defineProps<{ run: AiToolRun; submit: (answer: AiUserAnswer) => Promise<boolean> }>()
const { t } = useI18n()
const questions = computed(() => {
  try { return validateAiQuestions(JSON.parse(props.run.args)) } catch { return [] }
})
const selected = reactive<Record<string, string[]>>({})
const text = reactive<Record<string, string>>({})
const busy = ref(false)
const error = ref('')
function toggle(id: string, label: string, multiple?: boolean) {
  const values = selected[id] || []
  selected[id] = multiple ? values.includes(label) ? values.filter(value => value !== label) : [...values, label] : [label]
}
const response = () => ({ cancelled: false, answers: questions.value.map(question => ({ id: question.id, selected: selected[question.id] || [], text: text[question.id] || '' })) })
const canSubmit = computed(() => {
  if (!questions.value.length) return false
  try { validateAiUserAnswer(response(), questions.value); return true } catch { return false }
})
async function send(cancelled: boolean) {
  if (busy.value || (!cancelled && !canSubmit.value)) return
  busy.value = true
  error.value = ''
  try {
    if (!await props.submit(cancelled ? { cancelled: true, answers: [] } : response())) error.value = t('ai.question.sendFailed')
  } catch { error.value = t('ai.question.sendFailed') }
  finally { busy.value = false }
}
</script>

<template>
  <form class="ai-question-card" @submit.prevent="send(false)">
    <div class="ai-question-title">{{ t('ai.question.title') }}</div>
    <p class="ai-question-hint">{{ t('ai.question.hint') }}</p>
    <fieldset v-for="question in questions" :key="question.id" :disabled="busy">
      <legend>{{ question.question }}</legend>
      <span v-if="question.multiple && question.options" class="ai-question-multiple">{{ t('ai.question.multiple') }}</span>
      <label v-for="option in question.options" :key="option.label" class="ai-question-option" :class="{ selected: selected[question.id]?.includes(option.label) }">
        <input :type="question.multiple ? 'checkbox' : 'radio'" :name="`${run.id}-${question.id}`" :checked="selected[question.id]?.includes(option.label) || false" @change="toggle(question.id, option.label, question.multiple)" />
        <span><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span>
      </label>
      <textarea v-model="text[question.id]" rows="2" maxlength="4000" :aria-label="question.question" :placeholder="question.options ? t('ai.question.customAnswer') : t('ai.question.answerPlaceholder')" />
      <button v-if="selected[question.id]?.length" type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="selected[question.id] = []">{{ t('ai.question.clearSelection') }}</button>
    </fieldset>
    <p v-if="!questions.length" class="ai-question-error">{{ t('ai.question.invalid') }}</p>
    <p v-if="error" class="ai-question-error" role="alert">{{ error }}</p>
    <div class="ai-question-actions">
      <button type="button" class="ui-btn ui-btn-sm" :disabled="busy" @click="send(true)">{{ t('ai.question.skip') }}</button>
      <button type="submit" class="ui-btn ui-btn-sm ui-btn-primary" :disabled="busy || !canSubmit">{{ busy ? t('ai.question.sending') : t('ai.question.submit') }}</button>
    </div>
  </form>
</template>

<style scoped>
.ai-question-card { margin: 8px 12px; padding: 14px; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-primary); max-height: min(50vh, 480px); overflow: auto; color: var(--text-primary); font-size: 12px; }
.ai-question-title { font-weight: 600; font-size: 13px; }
.ai-question-hint, .ai-question-multiple { color: var(--text-secondary); line-height: 1.5; font-size: 11px; }
fieldset { min-width: 0; border: 0; padding: 0; margin: 14px 0 0; }
legend { padding: 0; margin-bottom: 8px; font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; }
.ai-question-option { display: flex; align-items: flex-start; gap: 8px; padding: 9px 10px; margin-top: 6px; border: 1px solid var(--border-color); border-radius: 8px; cursor: pointer; line-height: 1.4; }
.ai-question-option:hover { background: var(--hover-bg); }
.ai-question-option.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary)); }
.ai-question-option input { margin-top: 2px; accent-color: var(--accent); flex-shrink: 0; }
.ai-question-option span { min-width: 0; overflow-wrap: anywhere; }
.ai-question-option strong { font-weight: 500; }
.ai-question-option small { display: block; color: var(--text-secondary); margin-top: 3px; font-size: 11px; }
textarea { box-sizing: border-box; display: block; width: 100%; resize: vertical; min-height: 52px; max-height: 140px; padding: 9px 10px; margin-top: 8px; border: 1px solid var(--border-color); border-radius: 8px; color: var(--text-primary); background: var(--bg-secondary); font: inherit; line-height: 1.5; }
textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.ai-question-error { color: var(--danger); font-size: 11px; }
.ai-question-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; margin-top: 12px; }
</style>
