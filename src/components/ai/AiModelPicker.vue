<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{ open: boolean; providerName: string; models: string[] | null; added: string[]; loading: boolean; error: string; returnFocus?: HTMLElement | null }>()
const emit = defineEmits<{ close: []; retry: []; add: [ids: string[]] }>()
const { t } = useI18n()
const query = ref('')
const selected = ref<string[]>([])
const panel = ref<HTMLElement | null>(null)
const search = ref<HTMLInputElement | null>(null)
const filtered = computed(() => (props.models || []).filter(id => id.toLowerCase().includes(query.value.trim().toLowerCase())))
let previousFocus: HTMLElement | null = null
watch(() => props.open, async open => {
  if (open) {
    previousFocus = props.returnFocus || document.activeElement as HTMLElement | null
    query.value = ''
    selected.value = []
    await nextTick()
    search.value?.focus()
  } else {
    await nextTick()
    if (previousFocus?.isConnected) {
      if (previousFocus.matches(':disabled')) previousFocus.parentElement?.querySelector<HTMLElement>('button:not(:disabled)')?.focus()
      else previousFocus.focus()
    }
  }
})
function trapFocus(event: KeyboardEvent) {
  const elements = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || [])].filter(element => element.checkVisibility())
  const first = elements[0], last = elements.at(-1)
  if (event.shiftKey && (document.activeElement === first || !panel.value?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
onBeforeUnmount(() => { if (props.open && previousFocus?.isConnected) previousFocus.focus() })
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="model-picker-layer" @click.self="emit('close')" @keydown.esc.stop.prevent="emit('close')">
      <section ref="panel" class="model-picker" role="dialog" aria-modal="true" aria-labelledby="ai-model-picker-title" @keydown.tab="trapFocus">
        <header>
          <div><h3 id="ai-model-picker-title">{{ t('ai.settingsUi.chooseModels') }}</h3><p>{{ providerName }}</p></div>
          <button type="button" class="ui-icon-btn model-picker-close" :title="t('common.close')" :aria-label="t('common.close')" @click="emit('close')"><AppIcon name="close" size="sm" /></button>
        </header>
        <label class="model-picker-search"><AppIcon name="search" size="sm" /><input ref="search" v-model="query" class="ui-input ui-input-sm" :placeholder="t('ai.searchModels')" :aria-label="t('ai.searchModels')" /></label>
        <div class="model-picker-list" :aria-busy="loading">
          <p v-if="loading" class="model-picker-status" role="status">{{ t('ai.fetchingModels') }}</p>
          <div v-else-if="error" class="model-picker-status"><p class="model-fetch-error" role="alert">{{ error }}</p><button type="button" class="ui-btn ui-btn-sm" @click="emit('retry')"><AppIcon name="refresh" size="sm" />{{ t('ai.fetchModels') }}</button></div>
          <template v-else>
            <label v-for="id in filtered" :key="id" class="model-choice" :class="{ added: added.includes(id) }">
              <input v-if="added.includes(id)" type="checkbox" checked disabled /><input v-else v-model="selected" type="checkbox" :value="id" />
              <span>{{ id }}</span><small v-if="added.includes(id)">{{ t('ai.modelAdded') }}</small>
            </label>
            <p v-if="!filtered.length" class="model-picker-status">{{ t('ai.noMatchingModels') }}</p>
          </template>
        </div>
        <footer class="provider-item-actions">
          <span aria-live="polite">{{ t('ai.settingsUi.selectedModels', { count: selected.length }) }}</span>
          <button type="button" class="ui-btn ui-btn-sm model-picker-cancel" @click="emit('close')">{{ t('common.cancel') }}</button>
          <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" :disabled="loading || !selected.length" @click="emit('add', selected.filter(id => !added.includes(id)))"><AppIcon name="plus" size="sm" />{{ t('ai.addSelectedModels', { count: selected.length }) }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.model-picker-layer { position: fixed; inset: 0; z-index: var(--z-dialog-blocking); display: grid; place-items: center; padding: var(--space-5); background: var(--overlay-bg); }
.model-picker { display: flex; flex-direction: column; width: min(620px, 100%); max-height: min(700px, calc(100dvh - 48px)); min-height: min(420px, calc(100dvh - 48px)); border: 1px solid var(--border-color); border-radius: var(--radius-dialog); background: var(--bg-primary); color: var(--text-primary); box-shadow: var(--shadow-dialog); overflow: hidden; }
header { display: flex; align-items: center; gap: var(--space-3); padding: 18px 20px 12px; flex-shrink: 0; }
header > div { flex: 1; min-width: 0; } h3 { margin: 0; font-size: var(--font-section); } header p { margin: 4px 0 0; font-size: var(--font-ui-sm); color: var(--text-secondary); overflow-wrap: anywhere; }
.model-picker-search { display: flex; align-items: center; gap: var(--space-2); margin: 0 20px 12px; color: var(--text-secondary); flex-shrink: 0; }
.model-picker-search input { min-width: 0; width: 100%; }
.model-picker-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 12px 12px; overscroll-behavior: contain; }
.model-choice { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: var(--space-2); border-radius: var(--radius-sm); font-size: var(--font-ui-sm); cursor: pointer; }
.model-choice:hover { background: var(--hover-bg); } .model-choice input { flex-shrink: 0; accent-color: var(--accent); } .model-choice span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.model-choice.added { color: var(--text-secondary); cursor: default; } .model-choice small { flex-shrink: 0; padding: 2px 6px; border-radius: 4px; background: var(--bg-secondary); font-size: var(--font-caption); }
.model-picker-status { margin: auto; padding: 24px 8px; color: var(--text-secondary); font-size: var(--font-ui-sm); text-align: center; } .model-picker-status button { margin-top: 12px; } .model-fetch-error { color: var(--danger); overflow-wrap: anywhere; }
footer { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: var(--space-2); padding: 14px 20px; border-top: 1px solid var(--border-color); flex-shrink: 0; } footer > span { margin-right: auto; font-size: var(--font-ui-sm); color: var(--text-secondary); }
:is(button, input):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
@media (max-width: 480px) { .model-picker-layer { padding: var(--space-3); } .model-picker { max-height: calc(100dvh - 24px); } header, footer { padding-left: 12px; padding-right: 12px; } .model-picker-search { margin-left: 12px; margin-right: 12px; } }
</style>
