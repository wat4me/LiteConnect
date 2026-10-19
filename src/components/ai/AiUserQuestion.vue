<script setup lang="ts">
import { computed, nextTick, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { validateAiQuestions, validateAiUserAnswer, type AiUserAnswer } from '@shared/aiQuestions'
import type { AiToolRun } from '@shared/types/ai'
import AppIcon from '../icons/AppIcon.vue'
const props = defineProps<{ run: AiToolRun; submit: (answer: AiUserAnswer) => Promise<boolean>; allowStop?: boolean }>()
const emit = defineEmits<{ stop: [] }>()
const { t } = useI18n()
const questions = computed(() => {
  try { return validateAiQuestions(JSON.parse(props.run.args)) } catch { return [] }
})
const selected = reactive<Record<string, string[]>>({})
const text = reactive<Record<string, string>>({})
const custom = reactive<Record<string, boolean>>({})
const form = ref<HTMLFormElement>()
const currentIndex = ref(0)
const displayedQuestions = computed(() => questions.value.slice(currentIndex.value, currentIndex.value + 1))
const answered = computed(() => questions.value.map(question => custom[question.id]
  ? Boolean(text[question.id]?.trim()) : Boolean(selected[question.id]?.length || text[question.id]?.trim())))
const missingCount = computed(() => answered.value.filter(value => !value).length)
const hasNext = computed(() => currentIndex.value + 1 < questions.value.length)
const busy = ref(false)
const error = ref('')
async function goTo(index: number) {
  if (busy.value || index < 0 || index >= questions.value.length || index === currentIndex.value) return
  currentIndex.value = index
  error.value = ''
  await nextTick()
  form.value?.querySelector('.ai-question-content')?.scrollTo({ top: 0 })
  form.value?.querySelector<HTMLElement>('legend')?.focus({ preventScroll: true })
}
function toggle(id: string, label: string, multiple?: boolean) {
  if (!multiple) custom[id] = false
  const values = selected[id] || []
  selected[id] = multiple ? values.includes(label) ? values.filter(value => value !== label) : [...values, label] : [label]
}
async function chooseCustom(id: string, multiple?: boolean) {
  custom[id] = multiple ? !custom[id] : true
  if (!multiple) selected[id] = []
  if (custom[id]) {
    await nextTick()
    form.value?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true })
  }
}
const response = () => ({ cancelled: false, answers: questions.value.map(question => ({ id: question.id, selected: selected[question.id] || [], text: text[question.id] || '' })) })
const canSubmit = computed(() => {
  if (!questions.value.length || missingCount.value) return false
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
function submitPage() {
  if (busy.value) return
  if (hasNext.value) void goTo(currentIndex.value + 1)
  else void send(false)
}
</script>

<template>
  <form ref="form" class="ai-question-card" @submit.prevent="submitPage">
    <div class="ai-question-heading">
      <div class="ai-question-title">{{ t('ai.question.title') }}</div>
      <button v-if="allowStop" type="button" class="ui-icon-btn ai-question-stop" :title="t('ai.stopGenerate')" :aria-label="t('ai.stopGenerate')" @click="emit('stop')"><AppIcon name="stop" size="sm" /></button>
    </div>
    <p class="ai-question-hint">{{ t('ai.question.hint') }}</p>
    <div v-if="questions.length > 1" class="ai-question-progress">
      <span>{{ t('ai.question.answerCount', { count: questions.length - missingCount, total: questions.length }) }}</span>
      <nav class="ai-question-steps" :aria-label="t('ai.question.navigation')">
        <button type="button" class="ui-icon-btn ai-question-previous" :disabled="busy || currentIndex === 0" :title="t('ai.question.previous')" :aria-label="t('ai.question.previous')" @click="goTo(currentIndex - 1)"><AppIcon name="chevron-left" size="sm" /></button>
        <span class="ai-question-page" aria-live="polite" :aria-label="t('ai.question.progress', { current: currentIndex + 1, total: questions.length })">{{ currentIndex + 1 }} / {{ questions.length }}</span>
        <button type="button" class="ui-icon-btn ai-question-forward" :disabled="busy || !hasNext" :title="t('ai.question.next')" :aria-label="t('ai.question.next')" @click="goTo(currentIndex + 1)"><AppIcon name="chevron-right" size="sm" /></button>
      </nav>
    </div>
    <div class="ai-question-content">
      <fieldset v-for="question in displayedQuestions" :key="question.id" :disabled="busy">
        <legend tabindex="-1">{{ question.question }}</legend>
        <span v-if="question.multiple && question.options" class="ai-question-multiple">{{ t('ai.question.multiple') }}</span>
        <label v-for="option in question.options" :key="option.label" class="ai-question-option" :class="{ selected: selected[question.id]?.includes(option.label) }">
          <input :type="question.multiple ? 'checkbox' : 'radio'" :name="`${run.id}-${question.id}`" :checked="selected[question.id]?.includes(option.label) || false" @change="toggle(question.id, option.label, question.multiple)" />
          <span><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span>
        </label>
        <button v-if="selected[question.id]?.length" type="button" class="ui-btn ui-btn-xs ui-btn-ghost" @click="selected[question.id] = []">{{ t('ai.question.clearSelection') }}</button>
      </fieldset>
    </div>
    <div v-for="question in displayedQuestions" :key="`answer-${question.id}`" class="ai-question-answer">
      <label v-if="question.options" class="ai-question-custom" :class="{ selected: custom[question.id] }">
        <input :type="question.multiple ? 'checkbox' : 'radio'" :name="`${run.id}-${question.id}`" :checked="custom[question.id] || false" :disabled="busy" @change="chooseCustom(question.id, question.multiple)" />
        <span>{{ t('ai.question.otherAnswer') }}</span>
      </label>
      <label class="ai-question-text-label" :for="`${run.id}-${question.id}-text`">{{ t(question.options && !custom[question.id] ? 'ai.question.answerOrNote' : 'ai.question.yourAnswer') }}</label>
      <textarea :id="`${run.id}-${question.id}-text`" v-model="text[question.id]" :disabled="busy" rows="2" maxlength="4000" :placeholder="t('ai.question.answerPlaceholder')" />
    </div>
    <p v-if="!questions.length" class="ai-question-error">{{ t('ai.question.invalid') }}</p>
    <p v-if="error" class="ai-question-error" role="alert">{{ error }}</p>
    <p v-if="questions.length > 1 && !hasNext && missingCount" class="ai-question-missing" role="status">{{ t('ai.question.missingAnswers', { count: missingCount }) }} <button type="button" class="ui-btn ui-btn-xs" :disabled="busy" @click="goTo(answered.findIndex(value => !value))">{{ t('ai.question.completeAnswers') }}</button></p>
    <div class="ai-question-actions">
      <button type="button" class="ui-btn ui-btn-sm ai-question-skip" :disabled="busy" @click="send(true)">{{ t(questions.length > 1 ? 'ai.question.skipAll' : 'ai.question.skip') }}</button>
      <div class="ai-question-page-actions">
        <button v-if="hasNext" type="button" class="ui-btn ui-btn-sm ui-btn-primary ai-question-next" :disabled="busy" @click="goTo(currentIndex + 1)">{{ t('ai.question.next') }}</button>
        <button v-else type="submit" class="ui-btn ui-btn-sm ui-btn-primary" :disabled="busy || !canSubmit">{{ busy ? t('ai.question.sending') : t('ai.question.submit') }}</button>
      </div>
    </div>
  </form>
</template>

<style scoped>
.ai-question-card { display: flex; flex-direction: column; box-sizing: border-box; min-height: 0; margin: 8px 12px; padding: 14px; border: 1px solid var(--border-color); border-radius: var(--radius-lg); background: var(--bg-primary); max-height: min(70vh, 600px); overflow: hidden; color: var(--text-primary); font-size: var(--font-ui-sm); }
.ai-question-content { min-height: 0; overflow: auto; padding: 3px; margin: -3px; }
.ai-question-heading, .ai-question-hint, .ai-question-progress, .ai-question-answer, .ai-question-actions, .ai-question-error, .ai-question-missing { flex-shrink: 0; }
.ai-question-heading { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.ai-question-stop { border: 1px solid var(--border-color); color: var(--danger); }
.ai-question-title { font-weight: 600; font-size: var(--font-ui); }
.ai-question-hint, .ai-question-multiple { color: var(--text-secondary); line-height: 1.5; font-size: var(--font-caption); }
.ai-question-progress { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-top: 12px; font-size: var(--font-caption); font-weight: 500; }
.ai-question-steps { display: flex; align-items: center; gap: var(--space-1); }
.ai-question-steps button { width: 28px; height: 28px; border: 1px solid var(--border-color); }
.ai-question-page { min-width: 40px; text-align: center; font-variant-numeric: tabular-nums; }
legend:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ai-question-answer { padding-top: 10px; }
.ai-question-custom { display: flex; align-items: center; gap: var(--space-2); padding: 8px 10px; border: 1px solid var(--border-color); border-radius: var(--radius-md); cursor: pointer; }
.ai-question-custom.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary)); }
.ai-question-custom input { margin: 0; accent-color: var(--accent); }
.ai-question-text-label { display: block; margin-top: 8px; color: var(--text-secondary); font-size: var(--font-caption); }
fieldset { min-width: 0; border: 0; padding: 0; margin: 14px 0 0; }
legend { padding: 0; margin-bottom: 8px; font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; }
.ai-question-option { display: flex; align-items: flex-start; gap: var(--space-2); padding: 9px 10px; margin-top: 6px; border: 1px solid var(--border-color); border-radius: var(--radius-md); cursor: pointer; line-height: 1.4; }
.ai-question-option:hover { background: var(--hover-bg); }
.ai-question-option.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary)); }
.ai-question-option input { margin-top: 2px; accent-color: var(--accent); flex-shrink: 0; }
.ai-question-option span { min-width: 0; overflow-wrap: anywhere; }
.ai-question-option strong { font-weight: 500; }
.ai-question-option small { display: block; color: var(--text-secondary); margin-top: 3px; font-size: var(--font-caption); }
textarea { box-sizing: border-box; display: block; width: 100%; resize: none; min-height: 52px; padding: 9px 10px; margin-top: 4px; border: 1px solid var(--border-color); border-radius: var(--radius-md); color: var(--text-primary); background: var(--bg-secondary); font: inherit; line-height: 1.5; }
textarea:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.ai-question-error { color: var(--danger); font-size: var(--font-caption); }
.ai-question-missing { color: var(--text-secondary); font-size: var(--font-caption); line-height: 1.5; }
.ai-question-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: var(--space-2); margin-top: 12px; }
.ai-question-page-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
</style>
