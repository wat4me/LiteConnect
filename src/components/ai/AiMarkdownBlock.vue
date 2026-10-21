<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { MarkdownBlock } from '@/composables/ai/useMarkdownRenderer'
import AppIcon from '../icons/AppIcon.vue'

defineProps<{ block: MarkdownBlock; terminalActions: boolean }>()
const emit = defineEmits<{ (e: 'fill-code', code: string): void; (e: 'run-code', code: string): void }>()
const { t } = useI18n()
const copied = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined
onBeforeUnmount(() => clearTimeout(timer))
async function copyText(text: string) {
  const content = text.trim()
  if (!content) return
  try {
    await window.LiteConnect.clipboardWriteText(content)
    copied.value = true
    clearTimeout(timer)
    timer = setTimeout(() => { copied.value = false }, 1400)
  } catch (error: any) { ElMessage.warning(error?.message || t('common.copyFailed')) }
}
</script>

<template>
  <div v-if="block.type === 'code'" class="code-block">
    <div class="code-block-header">
      <span class="code-language">{{ block.language || 'text' }}</span>
      <div class="code-actions">
        <button v-if="terminalActions" type="button" class="code-action-btn" :title="t('ai.fillTerminal')" @click="emit('fill-code', block.content)">{{ t('ai.fill') }}</button>
        <button v-if="terminalActions" type="button" class="code-action-btn primary" :title="t('ai.runTerminal')" @click="emit('run-code', block.content)">{{ t('ai.run') }}</button>
        <button type="button" class="copy-btn" :title="copied ? t('common.copied') : t('ai.copyCode')" @click="copyText(block.content)">
          <AppIcon :name="copied ? 'check' : 'copy'" size="sm" />
        </button>
      </div>
    </div>
    <pre class="markdown-code"><code>{{ block.content }}</code></pre>
  </div>
  <div v-else class="markdown-block" v-html="block.content"></div>
</template>

<style scoped src="./AiChatView.css"></style>
