<script setup lang="ts">
import { watch } from 'vue'
import { useStreamingMarkdown } from '@/composables/ai/useStreamingMarkdown'
import AiMarkdownBlock from './AiMarkdownBlock.vue'

const props = defineProps<{ content: string; streaming: boolean; terminalActions?: boolean }>()
const emit = defineEmits<{
  (e: 'fill-code', code: string): void
  (e: 'run-code', code: string): void
  (e: 'layout'): void
}>()
const blocks = useStreamingMarkdown(() => props.content, () => props.streaming)
// Parsing may finish after the message-length watcher has already followed scroll.
watch(blocks, () => emit('layout'), { flush: 'post' })
</script>

<template>
  <div class="ai-streaming-markdown">
    <AiMarkdownBlock
      v-for="(block, index) in blocks" :key="index" :block="block"
      :terminal-actions="terminalActions !== false && !streaming"
      @fill-code="emit('fill-code', $event)" @run-code="emit('run-code', $event)"
    />
  </div>
</template>
