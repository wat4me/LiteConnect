<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { layoutKnowledgeSystem } from '@shared/aiKnowledgeSystemLayout'
import type { KnowledgeSystem, KnowledgeSystemMember } from '@shared/aiKnowledgeSystem'
const props = defineProps<{ system: KnowledgeSystem; members: KnowledgeSystemMember[]; selectedIds?: string[]; offline?: boolean }>()
const { t } = useI18n()
const marker = `system-arrow-${useId().replace(/[^\w-]/g, '')}`
const layout = computed(() => layoutKnowledgeSystem(props.system))
const positions = computed(() => new Map(layout.value.nodes.map(node => [node.id, node])))
function member(node: KnowledgeSystem['nodes'][number]) { return props.members.find(member => member.connectionId === node.connectionId && member.binding === node.binding && member.available) }
const missing = computed(() => props.system.nodes.filter(node => !member(node)))
function path(from: string, to: string) {
  const a = positions.value.get(from), b = positions.value.get(to)
  if (!a || !b) return ''
  if (b.x > a.x) return `M ${a.x + 170} ${a.y + 45} C ${a.x + 195} ${a.y + 45}, ${b.x - 25} ${b.y + 45}, ${b.x} ${b.y + 45}`
  return `M ${a.x + 170} ${a.y + 45} C ${a.x + 210} ${a.y + 45}, ${b.x + 210} ${b.y + 45}, ${b.x + 170} ${b.y + 45}`
}
const short = (text: string, max: number) => { const chars = [...text]; return chars.length > max ? `${chars.slice(0, max).join('')}…` : text }
</script>

<template>
  <section class="knowledge-system-view">
    <p class="system-description">{{ system.description || t('ai.knowledge.system.noDescription') }}</p>
    <p class="system-legend">{{ t('ai.knowledge.system.legend') }}</p>
    <p v-if="missing.length" class="system-warning" role="status">{{ t('ai.knowledge.system.memberChanged') }}</p>
    <div v-if="system.nodes.length" class="system-graph-scroll" role="region" :aria-label="t('ai.knowledge.system.graph')" tabindex="0">
      <svg :width="layout.width" :height="layout.height" :viewBox="`0 0 ${layout.width} ${layout.height}`" role="img" :aria-label="t('ai.knowledge.system.graph')">
        <defs><marker :id="marker" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="var(--text-secondary)" /></marker></defs>
        <path v-for="(edge, index) in system.dependencies" :key="index" :d="path(edge.from, edge.to)" fill="none" stroke="var(--text-secondary)" stroke-width="1.5" :stroke-dasharray="edge.status === 'unconfirmed' ? '5 4' : undefined" :marker-end="`url(#${marker})`"><title>{{ edge.label }} · {{ t(`ai.knowledge.system.${edge.status}`) }}</title></path>
        <g v-for="node in layout.nodes" :key="node.id" :transform="`translate(${node.x}, ${node.y})`" class="system-graph-node" :class="{ stale: !member(node), unconfirmed: node.status === 'unconfirmed' }">
          <title>{{ node.role }} · {{ member(node)?.name || node.connectionId }} · {{ node.note }}</title>
          <rect width="170" height="90" rx="9" />
          <text x="12" y="24" class="system-role">{{ short(node.role, 10) }}</text><text x="12" y="46">{{ short(member(node)?.name || node.connectionId, 12) }}</text>
          <text x="12" y="69">{{ !member(node) ? t('ai.knowledge.system.stale') : t(`ai.knowledge.system.${node.status}`) }}<tspan v-if="!offline && !selectedIds?.includes(node.connectionId)"> · {{ t('ai.knowledge.system.notSelected') }}</tspan></text>
        </g>
      </svg>
    </div>
    <p v-else class="system-legend">{{ t('ai.knowledge.system.empty') }}</p>
    <dl v-if="system.nodes.length" class="system-role-list"><template v-for="node in system.nodes" :key="node.id"><dt>{{ node.role }} · {{ member(node)?.name || node.connectionId }} <small>{{ t(`ai.knowledge.system.${node.status}`) }}</small></dt><dd v-if="node.note">{{ node.note }}</dd></template></dl>
    <ul v-if="system.dependencies.length" class="system-edge-list"><li v-for="(edge, index) in system.dependencies" :key="index">{{ positions.get(edge.from)?.role }} → {{ positions.get(edge.to)?.role }}<span v-if="edge.label"> · {{ edge.label }}</span><small> · {{ t(`ai.knowledge.system.${edge.status}`) }}</small></li></ul>
  </section>
</template>

<style scoped>
.system-description { white-space: pre-wrap; overflow-wrap: anywhere; line-height: 1.65; }
.system-legend, small { color: var(--text-secondary); font-size: var(--font-caption); }
.system-warning { color: var(--warning); font-size: var(--font-caption); }
.system-graph-scroll { max-width: 100%; overflow: auto; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-secondary); }
svg { display: block; } .system-graph-node rect { fill: var(--bg-primary); stroke: var(--accent); stroke-width: 1.5; }
.system-graph-node.unconfirmed rect { stroke-dasharray: 5 3; } .system-graph-node.stale rect { stroke: var(--warning); stroke-dasharray: 3 3; }
text { font: 11px var(--font-family, sans-serif); fill: var(--text-secondary); } .system-role { font-size: 13px; font-weight: 600; fill: var(--text-primary); }
.system-role-list, .system-edge-list { font-size: var(--font-caption); line-height: 1.7; overflow-wrap: anywhere; }
dt { margin-top: 6px; font-weight: 600; } dd { margin: 0 0 0 12px; color: var(--text-secondary); }
</style>
