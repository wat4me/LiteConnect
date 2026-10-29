<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import AiKnowledge from '../../src/components/ai/AiKnowledge.vue'
import AiToolRun from '../../src/components/ai/AiToolRun.vue'
import AppDialogHost from '../../src/components/app/AppDialogHost.vue'
import { setAppLocale } from '../../src/i18n'
import { useTheme } from '../../src/composables/app/useTheme'
import type { AiToolRun as ToolRun } from '../../shared/types/ai'
const backend = (window as any).__knowledgeBackend
;(window as any).LiteConnect = {
  aiKnowledge: (session: string, input: unknown) => backend.invoke('manage', { session, input }),
  aiImportKnowledgeFile: () => backend.invoke('import'),
  aiExportKnowledge: (session: string, connectionId: string, documentId: string) => backend.invoke('export', { session, connectionId, documentId }),
  clipboardWriteText: async () => {},
}
const knowledge = ref<InstanceType<typeof AiKnowledge>>()
const active = ref(true), busy = ref(false), sessionId = ref('fixture')
const run = ref<ToolRun>()
const theme = useTheme()
onMounted(() => {
  ;(window as any).__knowledge = {
    async show(server?: string, id?: string) { await knowledge.value?.show(server, id) },
    async aiSave(id: string) {
      const result = await backend.invoke('ai-save', { id })
      run.value = { id: 'knowledge-save', name: 'knowledge_save', args: '{}', content: JSON.stringify(result.structuredContent), isError: false, status: 'done' }
      busy.value = true; await nextTick(); busy.value = false
    },
    async scope(session: string, shown = true) { sessionId.value = session; active.value = shown; await nextTick() },
    async busy(value: boolean) { busy.value = value; await nextTick() },
    async theme(value: 'light' | 'dark' | 'eyecare', locale: 'zh-CN' | 'en-US') { theme.setTheme(value); setAppLocale(locale); await nextTick() },
  }
})
</script>
<template><div class="knowledge-fixture-titlebar" style="position: fixed; inset: 0 0 auto; height: 36px; -webkit-app-region: drag"></div><div style="padding: 48px 24px 24px"><AiKnowledge ref="knowledge" :session-id="sessionId" :active="active" :busy="busy" /><AiToolRun v-if="run" :run="run" @view-knowledge="knowledge?.show('a', JSON.parse(run!.content).documentId)" /><AppDialogHost /></div></template>
