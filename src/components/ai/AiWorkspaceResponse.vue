<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { AiWorkspaceTarget } from '@shared/aiWorkspace'
import { useMarkdownRenderer } from '@/composables/ai/useMarkdownRenderer'
import { workspaceResponseSections } from '@/utils/ai/workspaceResponse'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{ text: string; targets: AiWorkspaceTarget[] }>()
const { t } = useI18n()
const { parseMarkdown } = useMarkdownRenderer()
const sections = computed(() => workspaceResponseSections(props.text, props.targets).map(section => ({ ...section, blocks: parseMarkdown(section.text) })))
const copied = ref('')
let timer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(timer))
async function copy(text: string, key: string) {
  try {
    await window.LiteConnect.clipboardWriteText(text.trim())
    copied.value = key
    clearTimeout(timer)
    timer = setTimeout(() => { copied.value = '' }, 1400)
  } catch { ElMessage.warning(t('common.copyFailed')) }
}
</script>

<template>
  <div class="workspace-response">
    <component :is="section.connectionId ? 'details' : 'div'" v-for="(section, sectionIndex) in sections" :key="sectionIndex" :class="section.connectionId ? 'workspace-response-host' : 'workspace-response-overview'" :data-connection-id="section.connectionId">
      <summary v-if="section.connectionId" :title="t('ai.workspace.serverDetails')"><AppIcon name="chevron-right" size="xs" /><span>{{ section.title }}</span></summary>
      <div :class="{ 'workspace-response-body': section.connectionId }">
        <template v-for="(block, index) in section.blocks" :key="index">
          <div v-if="block.type === 'code'" class="code-block">
            <div class="code-block-header">
              <span class="code-language">{{ block.language || 'text' }}</span>
              <button type="button" class="copy-btn" :title="copied === `${sectionIndex}-${index}` ? t('common.copied') : t('ai.copyCode')" @click="copy(block.content, `${sectionIndex}-${index}`)"><AppIcon :name="copied === `${sectionIndex}-${index}` ? 'check' : 'copy'" size="sm" /></button>
            </div>
            <pre class="markdown-code"><code>{{ block.content }}</code></pre>
          </div>
          <div v-else class="markdown-block" v-html="block.content"></div>
        </template>
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
