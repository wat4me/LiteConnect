<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiWorkspaceTarget } from '@shared/aiWorkspace'
import { workspaceResponseSections } from '@/utils/ai/workspaceResponse'
import AppIcon from '../icons/AppIcon.vue'
import AiStreamingMarkdown from './AiStreamingMarkdown.vue'

const props = defineProps<{ text: string; targets: AiWorkspaceTarget[] }>()
const { t } = useI18n()
const sections = computed(() => workspaceResponseSections(props.text, props.targets).map((section, index) => ({
  ...section, key: JSON.stringify([section.connectionId, section.title, index]),
})))
const openSections = reactive(new Set<string>())
watch(sections, values => {
  const keys = new Set(values.map(section => section.key))
  for (const key of openSections) if (!keys.has(key)) openSections.delete(key)
})
function onToggle(key: string, event: Event) {
  if (event.target !== event.currentTarget || !(event.currentTarget instanceof HTMLDetailsElement)) return
  if (event.currentTarget.open) openSections.add(key)
  else openSections.delete(key)
}
</script>

<template>
  <div class="workspace-response">
    <component :is="section.connectionId ? 'details' : 'div'" v-for="section in sections" :key="section.key" :open="section.connectionId ? openSections.has(section.key) : undefined" :class="section.connectionId ? 'workspace-response-host' : 'workspace-response-overview'" :data-connection-id="section.connectionId" @toggle="onToggle(section.key, $event)">
      <summary v-if="section.connectionId" :title="t('ai.workspace.serverDetails')"><AppIcon name="chevron-right" size="xs" /><span>{{ section.title }}</span></summary>
      <div v-if="!section.connectionId || openSections.has(section.key)" :class="{ 'workspace-response-body': section.connectionId }">
        <AiStreamingMarkdown :content="section.text" :streaming="false" :terminal-actions="false" />
      </div>
    </component>
  </div>
</template>

<style scoped src="./AiChatView.css"></style>
<style scoped>
.workspace-response-host { margin: 10px 0; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-primary); min-width: 0; }
.workspace-response-host > summary { display: flex; align-items: center; gap: 8px; padding: 12px; cursor: pointer; list-style: none; font-weight: 600; font-size: 12px; }
.workspace-response-host > summary span { overflow-wrap: anywhere; }
.workspace-response-host > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; border-radius: 8px; }
.workspace-response-host[open] > summary :deep(.app-icon) { transform: rotate(90deg); }
.workspace-response-body { padding: 0 12px 12px; }
</style>
