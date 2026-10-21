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
// Selecting an optional custom note must not invalidate a valid multiple choice.
// Single-choice custom answers already clear the suggested selection.
const answered = computed(() => questions.value.map(question => Boolean(selected[question.id]?.length || text[question.id]?.trim())))
const missingCount = computed(() => answered.value.filter(value => !value).length)
const firstMissingIndex = computed(() => answered.value.findIndex(value => !value))
const attentionId = ref('')
const needsAttention = computed(() => attentionId.value === displayedQuestions.value[0]?.id && !answered.value[currentIndex.value])
const hasNext = computed(() => currentIndex.value + 1 < questions.value.length)
const busy = ref(false)
const error = ref('')
const statusId = computed(() => `${props.run.id}-status`)
const showComplete = computed(() => questions.value.length > 1 && !hasNext.value && missingCount.value > 0)
const statusText = computed(() => {
  if (!questions.value.length) return t('ai.question.invalid')
  if (error.value) return error.value
  const question = displayedQuestions.value[0]
  if (needsAttention.value) return t(question.options && !custom[question.id] ? 'ai.question.requiredChoice' : 'ai.question.requiredText')
  if (missingCount.value === 0) return t('ai.question.readyToSubmit')
  return t('ai.question.filling', { current: currentIndex.value + 1, total: questions.value.length })
})
async function goTo(index: number, focusAnswer = false) {
  if (busy.value || index < 0 || index >= questions.value.length) return
  currentIndex.value = index
  error.value = ''
  await nextTick()
  const content = form.value?.querySelector<HTMLElement>('.ai-question-content')
  content?.scrollTo({ top: 0 })
  const question = questions.value[index]
  const target = focusAnswer
    ? form.value?.querySelector<HTMLElement>(!question.options || custom[question.id] ? 'textarea' : 'fieldset input')
    : form.value?.querySelector<HTMLElement>('legend')
  target?.focus({ preventScroll: true })
  // Long prompts can put the first option below the visible options viewport.
  if (focusAnswer && target && content?.contains(target)) {
    content.scrollTop += Math.max(0, target.getBoundingClientRect().bottom - content.getBoundingClientRect().bottom + 8)
  }
}
function completeMissing() {
  const index = firstMissingIndex.value
  if (index < 0 || busy.value) return
  attentionId.value = questions.value[index].id
  void goTo(index, true)
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
      <div class="ai-question-heading-copy">
        <div class="ai-question-title" :title="t('ai.question.hint')">{{ t('ai.question.title') }}</div>
      </div>
    </div>
    <div v-if="questions.length > 1" class="ai-question-progress">
      <span>{{ t('ai.question.answerCount', { count: questions.length - missingCount, total: questions.length }) }}</span>
      <nav class="ai-question-steps" :aria-label="t('ai.question.navigation')">
        <button type="button" class="ui-icon-btn ai-question-previous" :disabled="busy || currentIndex === 0" :title="t('ai.question.previous')" :aria-label="t('ai.question.previous')" @click="goTo(currentIndex - 1)"><AppIcon name="chevron-left" size="sm" /></button>
        <span class="ai-question-page" aria-live="polite" :aria-label="t('ai.question.progress', { current: currentIndex + 1, total: questions.length })">{{ currentIndex + 1 }} / {{ questions.length }}</span>
        <button type="button" class="ui-icon-btn ai-question-forward" :disabled="busy || !hasNext" :title="t('ai.question.next')" :aria-label="t('ai.question.next')" @click="goTo(currentIndex + 1)"><AppIcon name="chevron-right" size="sm" /></button>
      </nav>
    </div>
    <div class="ai-question-status" :class="{ 'ai-question-missing': showComplete }">
      <div :id="statusId" class="ai-question-status-copy" role="status" aria-live="polite" aria-atomic="true">
        <span :class="{ 'ai-question-error': error || !questions.length, 'ai-question-required': needsAttention }" :role="error || !questions.length || needsAttention ? 'alert' : undefined">{{ statusText }}</span>
      </div>
      <button v-if="showComplete" type="button" class="ui-btn ui-btn-xs ui-btn-ghost ai-question-complete" :disabled="busy" @click="completeMissing">{{ t(firstMissingIndex === currentIndex ? 'ai.question.completeCurrent' : 'ai.question.completeQuestion', { number: firstMissingIndex + 1 }) }}<AppIcon name="chevron-right" size="xs" /></button>
    </div>
    <div class="ai-question-content">
      <fieldset v-for="question in displayedQuestions" :key="question.id" :disabled="busy" :class="{ 'needs-answer': needsAttention }" :aria-describedby="needsAttention ? statusId : undefined">
        <legend tabindex="-1">{{ question.question }}</legend>
        <span v-if="question.multiple && question.options" class="ai-question-multiple">{{ t('ai.question.multiple') }}</span>
        <label v-for="option in question.options" :key="option.label" class="ai-question-option" :class="{ selected: selected[question.id]?.includes(option.label) }">
          <input :type="question.multiple ? 'checkbox' : 'radio'" :name="`${run.id}-${question.id}`" :checked="selected[question.id]?.includes(option.label) || false" @change="toggle(question.id, option.label, question.multiple)" />
          <span><strong>{{ option.label }}</strong><small v-if="option.description">{{ option.description }}</small></span>
        </label>
        <button v-if="question.options" type="button" class="ui-btn ui-btn-xs ui-btn-ghost" :disabled="busy || !selected[question.id]?.length" @click="selected[question.id] = []">{{ t('ai.question.clearSelection') }}</button>
      </fieldset>
    </div>
    <div v-for="question in displayedQuestions" :key="`answer-${question.id}`" class="ai-question-answer">
      <label v-if="question.options" class="ai-question-custom" :class="{ selected: custom[question.id] }">
        <input :type="question.multiple ? 'checkbox' : 'radio'" :name="`${run.id}-${question.id}`" :checked="custom[question.id] || false" :disabled="busy" @change="chooseCustom(question.id, question.multiple)" />
        <span>{{ t('ai.question.otherAnswer') }}</span>
      </label>
      <label class="ai-question-text-label" :for="`${run.id}-${question.id}-text`">{{ t(question.options && !custom[question.id] ? 'ai.question.answerOrNote' : 'ai.question.yourAnswer') }}</label>
      <textarea :id="`${run.id}-${question.id}-text`" v-model="text[question.id]" :disabled="busy" :aria-invalid="needsAttention && (!question.options || custom[question.id]) ? true : undefined" :aria-describedby="needsAttention ? statusId : undefined" rows="2" maxlength="4000" :placeholder="t('ai.question.answerPlaceholder')" />
    </div>
    <div class="ai-question-footer">
      <div class="ai-question-actions">
        <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost ai-question-skip" :disabled="busy" @click="send(true)">{{ t(questions.length > 1 ? 'ai.question.skipAll' : 'ai.question.skip') }}</button>
        <div class="ai-question-page-actions">
          <button v-if="hasNext" type="button" class="ui-btn ui-btn-sm ui-btn-primary ai-question-next" :disabled="busy" @click="goTo(currentIndex + 1)">{{ t('ai.question.next') }}</button>
          <button v-else type="submit" class="ui-btn ui-btn-sm ui-btn-primary" :disabled="busy || !canSubmit">{{ busy ? t('ai.question.sending') : t('ai.question.submit') }}</button>
          <button v-if="allowStop" type="button" class="ui-icon-btn ai-question-stop" :title="t('ai.stopGenerate')" :aria-label="t('ai.stopGenerate')" @click="emit('stop')"><AppIcon name="stop" size="sm" /></button>
        </div>
      </div>
    </div>
  </form>
</template>

<style scoped>
.ai-question-card { display: flex; flex-direction: column; box-sizing: border-box; min-height: 0; width: calc(100% - 24px); max-width: 680px; align-self: center; margin: 8px auto; padding: var(--ai-composer-padding, 8px 10px); border: 1px solid var(--ai-composer-border, var(--border-color)); border-radius: var(--ai-composer-radius, 14px); background: var(--ai-composer-background, var(--bg-secondary)); box-shadow: var(--ai-composer-shadow, none); max-height: min(50vh, 380px); overflow: hidden; color: var(--text-primary); font-size: var(--font-ui-sm); }
.ai-question-card:focus-within { border-color: var(--ai-composer-focus-border, color-mix(in srgb, var(--accent) 50%, var(--border-color))); box-shadow: var(--ai-composer-focus-shadow, none); }
.ai-question-content { min-height: 0; overflow: auto; padding: 3px; margin: -3px; }
.ai-question-heading, .ai-question-progress, .ai-question-status, .ai-question-answer, .ai-question-footer { flex-shrink: 0; }
.ai-question-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-2); }
.ai-question-heading-copy { min-width: 0; }
.ai-question-stop { flex-shrink: 0; width: 28px; height: 28px; border: 1px solid var(--danger); border-radius: 50%; color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
.ai-question-title { font-weight: 500; font-size: var(--font-ui-sm); line-height: 28px; }
.ai-question-multiple { color: var(--text-secondary); line-height: 1.5; font-size: var(--font-caption); }
.ai-question-progress { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); margin-top: 2px; font-size: var(--font-caption); font-weight: 500; }
.ai-question-steps { display: flex; align-items: center; gap: var(--space-1); }
.ai-question-steps button { width: 24px; height: 24px; }
.ai-question-page { min-width: 40px; text-align: center; font-variant-numeric: tabular-nums; }
legend:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.ai-question-answer { margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--border-color); }
.ai-question-custom { display: flex; align-items: center; gap: var(--space-2); width: fit-content; max-width: 100%; padding: 3px 0; border-radius: var(--radius-sm); cursor: pointer; }
.ai-question-custom.selected { color: var(--accent); }
.ai-question-custom:focus-within { outline: 2px solid var(--accent); outline-offset: 2px; }
.ai-question-custom input { margin: 0; accent-color: var(--accent); }
.ai-question-text-label { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
fieldset { min-width: 0; border: 0; padding: 0; margin: 6px 0 0; }
legend { padding: 0; margin-bottom: 4px; font-weight: 600; line-height: 1.5; overflow-wrap: anywhere; }
.ai-question-option { display: flex; align-items: flex-start; gap: var(--space-2); padding: 6px 8px; margin-top: 2px; border: 1px solid transparent; border-radius: var(--radius-md); cursor: pointer; line-height: 1.4; }
.ai-question-option:hover { background: var(--hover-bg); }
.ai-question-option:focus-within { outline: 2px solid var(--accent); outline-offset: 1px; }
.needs-answer legend { color: var(--warning); }
.ai-question-option.selected { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--bg-primary)); }
.ai-question-option input { margin-top: 2px; accent-color: var(--accent); flex-shrink: 0; }
.ai-question-option span { min-width: 0; overflow-wrap: anywhere; }
.ai-question-option strong { font-weight: 500; }
.ai-question-option small { display: block; color: var(--text-secondary); margin-top: 2px; font-size: var(--font-caption); }
textarea { box-sizing: border-box; display: block; width: 100%; resize: none; min-height: 40px; padding: var(--ai-composer-input-padding, 0); margin-top: 4px; border: 0; outline: none; color: var(--text-primary); background: transparent; font-family: inherit; font-size: var(--font-ui); line-height: var(--ai-composer-input-line-height, 1.5); }
textarea::placeholder { color: var(--text-secondary); }
.ai-question-error { color: var(--danger); font-size: var(--font-caption); }
.ai-question-required { color: var(--warning); }
.ai-question-footer { margin-top: 6px; }
.ai-question-status { display: flex; align-items: center; gap: 8px; height: 36px; color: var(--text-secondary); font-size: var(--font-caption); line-height: 1.5; }
.ai-question-status-copy { flex: 1; min-width: 0; max-height: 100%; overflow: auto; overflow-wrap: anywhere; }
.ai-question-complete { display: inline-flex; align-items: center; gap: 2px; max-width: 50%; flex-shrink: 0; color: var(--accent); }
.ai-question-actions { display: flex; align-items: center; flex-wrap: wrap; justify-content: space-between; gap: var(--space-2); }
.ai-question-page-actions { display: flex; align-items: center; gap: 8px; margin-left: auto; }
</style>
