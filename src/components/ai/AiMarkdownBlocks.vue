<script setup lang="ts">
import { useMarkdownRenderer } from '@/composables/ai/useMarkdownRenderer'

const props = defineProps<{ content: string }>()
const { parseMarkdown } = useMarkdownRenderer()
</script>

<template>
  <div class="ai-markdown-blocks">
    <template v-for="(block, index) in parseMarkdown(props.content || '')" :key="index">
      <pre v-if="block.type === 'code'" class="markdown-code-block"><code>{{ block.content }}</code></pre>
      <div v-else class="markdown-block" v-html="block.content"></div>
    </template>
  </div>
</template>

<style scoped>
.ai-markdown-blocks { font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; }
.markdown-block + .markdown-block,
.markdown-block + .markdown-code-block,
.markdown-code-block + .markdown-block,
.markdown-code-block + .markdown-code-block { margin-top: 8px; }
.markdown-block :deep(p) { margin: 0; }
.markdown-block :deep(h3),
.markdown-block :deep(h4),
.markdown-block :deep(h5),
.markdown-block :deep(h6) { margin: 8px 0 4px; font-size: 13px; line-height: 1.35; }
.markdown-block :deep(h1),
.markdown-block :deep(h2) { margin: 10px 0 6px; font-size: 14px; line-height: 1.35; }
.markdown-block :deep(ul),
.markdown-block :deep(ol) { margin: 4px 0 4px 16px; padding: 0; }
.markdown-block :deep(li) { margin: 2px 0; }
.markdown-block :deep(li.md-li-depth-1) { margin-left: 12px; }
.markdown-block :deep(li.md-li-depth-2) { margin-left: 24px; }
.markdown-block :deep(li.md-li-depth-3) { margin-left: 36px; }
.markdown-block :deep(li.md-li-depth-4) { margin-left: 48px; }
.markdown-block :deep(del) { text-decoration: line-through; opacity: 0.6; }
.markdown-block :deep(hr) { border: none; border-top: 1px solid var(--border-color); margin: 8px 0; }
.markdown-block :deep(blockquote) { margin: 4px 0; padding: 4px 8px; border-left: 2px solid var(--accent); color: var(--text-secondary); background: var(--accent-bg); }
.markdown-block :deep(code) { font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace); padding: 1px 4px; border-radius: 4px; background: var(--bg-tertiary); }
.markdown-block :deep(a) { color: var(--accent); }
.markdown-block :deep(.md-table-wrap) { overflow-x: auto; margin: 6px 0; }
.markdown-block :deep(.md-table) { width: 100%; border-collapse: collapse; font-size: 11px; }
.markdown-block :deep(.md-table th),
.markdown-block :deep(.md-table td) { border: 1px solid var(--border-color); padding: 4px 8px; text-align: left; vertical-align: top; }
.markdown-block :deep(.md-table th) { background: var(--bg-tertiary); font-weight: 600; }
.markdown-block :deep(.md-table tr:nth-child(even) td) { background: color-mix(in srgb, var(--bg-tertiary) 35%, transparent); }
.markdown-block :deep(.md-table td.md-status) { white-space: nowrap; }
.markdown-block :deep(.md-table td.md-row-alert) { border-left: 2px solid var(--danger); }
.markdown-block :deep(.md-status-chip) { display: inline-flex; align-items: center; gap: 5px; padding: 1px 7px; border: 1px solid transparent; border-radius: 999px; font-size: var(--font-caption); font-weight: 600; line-height: 1.5; }
.markdown-block :deep(.md-status-chip::before) { content: ''; width: 6px; height: 6px; flex-shrink: 0; border-radius: 50%; background: currentColor; }
.markdown-block :deep(.md-status-ok) { color: var(--success); background: color-mix(in srgb, var(--success) 12%, transparent); border-color: color-mix(in srgb, var(--success) 28%, transparent); }
.markdown-block :deep(.md-status-warning) { color: var(--warning); background: color-mix(in srgb, var(--warning) 14%, transparent); border-color: color-mix(in srgb, var(--warning) 30%, transparent); }
.markdown-block :deep(.md-status-danger) { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); border-color: color-mix(in srgb, var(--danger) 28%, transparent); }
.markdown-block :deep(.md-status-muted) { color: var(--text-secondary); background: var(--bg-tertiary); border-color: var(--border-color); }
.markdown-block :deep(p.md-conclusion) { margin: 8px 0 4px; padding: 8px 10px; border-left: 3px solid var(--accent); border-radius: var(--radius-sm); background: var(--accent-bg); line-height: var(--line-reading); }
.markdown-code-block { max-height: 260px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg-secondary); padding: 8px; border-radius: 5px; font-size: 12px; margin: 0; }
</style>
