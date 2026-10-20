<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElPopover } from 'element-plus/es/components/popover/index'
import 'element-plus/es/components/popover/style/css'
import type { AiContextPressure } from '@shared/types/ai'
import { useAiInfoPopover } from '@/composables/ai/useAiInfoPopover'
import { formatCompactTokenCount } from '@/utils/ai/tokenCount'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{
  pressure: AiContextPressure
  sourceLabel: string
  compactionCount: number
  canCompact: boolean
}>()
const emit = defineEmits<{ compact: [] }>()
const { t, locale } = useI18n()
const trigger = ref<HTMLElement | null>(null)
const detail = ref<HTMLElement | null>(null)
const detailId = useId()
const { open, show, close, toggle, hideLater, clearHideTimer, afterHide } = useAiInfoPopover(trigger, detail)
const ratio = computed(() => props.pressure.windowTokens > 0 ? props.pressure.usedTokens / props.pressure.windowTokens : 0)
const percent = computed(() => Math.round(ratio.value * 1000) / 10)
const percentLabel = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }).format(ratio.value))
const tone = computed(() => ratio.value >= 0.95 ? 'danger' : ratio.value >= 0.8 ? 'warn' : 'ok')
const compactUsage = computed(() => `${formatCompactTokenCount(props.pressure.usedTokens)} / ${formatCompactTokenCount(props.pressure.windowTokens)} tok`)
const count = (n: number) => `${new Intl.NumberFormat(locale.value).format(n)} tok`
const description = computed(() => `${t('ai.contextInfo.title')} · ${compactUsage.value} · ${percentLabel.value}。${t('ai.contextCompactAt', { tokens: props.pressure.thresholdTokens })}。${t('ai.contextMeterHint')}`)
function compact() { close(); emit('compact') }
</script>

<template>
  <ElPopover :visible="open" placement="top-start" :width="310" :show-arrow="false" :persistent="false" :teleported="true" :trigger-keys="[]" :offset="8"
    popper-class="ai-context-popover" :popper-style="{ maxWidth: 'calc(100vw - 24px)' }" @after-leave="afterHide">
    <template #reference>
      <span class="context-meter-trigger">
        <button ref="trigger" type="button" class="composer-context-meter" :class="[tone, { active: open }]"
          :aria-label="description" :aria-expanded="open" :aria-controls="open ? detailId : undefined"
          @mouseenter="show" @mouseleave="hideLater" @click="toggle">
          <svg viewBox="0 0 24 24" role="meter" :aria-label="t('ai.contextAria')" :aria-valuemin="0" :aria-valuemax="100"
            :aria-valuenow="Math.min(100, percent)" :aria-valuetext="description">
            <circle class="context-meter-track" cx="12" cy="12" r="9" />
            <circle class="context-meter-fill" cx="12" cy="12" r="9" pathLength="100" :stroke-dasharray="`${Math.min(100, ratio * 100)} 100`" transform="rotate(-90 12 12)" />
          </svg>
          <span class="context-meter-percent">{{ percentLabel }}</span>
        </button>
      </span>
    </template>
    <section :id="detailId" ref="detail" class="context-info" :aria-label="t('ai.contextInfo.title')" @mouseenter="clearHideTimer" @mouseleave="hideLater">
      <header class="context-info-heading"><strong>{{ t('ai.contextInfo.title') }}</strong><span>{{ percentLabel }}</span></header>
      <div class="context-info-summary">{{ compactUsage }}</div>
      <dl class="context-info-rows">
        <div><dt>{{ t('ai.contextInfo.used') }}</dt><dd>{{ count(pressure.usedTokens) }}</dd></div>
        <div><dt>{{ t('ai.contextInfo.capacity') }}</dt><dd>{{ count(pressure.windowTokens) }}</dd></div>
        <div><dt>{{ t('ai.contextInfo.outputReserve') }}</dt><dd>{{ count(pressure.outputReserveTokens) }}</dd></div>
        <div><dt>{{ t('ai.contextInfo.threshold') }}</dt><dd>{{ count(pressure.thresholdTokens) }}</dd></div>
        <div><dt>{{ t('ai.contextInfo.compactions') }}</dt><dd>{{ compactionCount }}</dd></div>
      </dl>
      <p class="context-info-source">{{ sourceLabel }}</p>
      <p class="context-info-hint">{{ t('ai.contextMeterHint') }}</p>
      <button type="button" class="ui-btn ui-btn-sm context-compact-button" :disabled="!canCompact" @click="compact"><AppIcon name="list-collapse" size="sm" />{{ t('ai.compactContext') }}</button>
    </section>
  </ElPopover>
</template>

<style scoped>
.context-meter-trigger { display: inline-flex; flex: 0 0 auto; }
.composer-context-meter { display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 34px; padding: 0 5px; border: 1px solid transparent; border-radius: var(--radius-sm); color: var(--text-secondary); background: transparent; font: inherit; font-size: var(--font-caption); cursor: pointer; }
.composer-context-meter:hover, .composer-context-meter.active { background: var(--hover-bg); color: var(--text-primary); border-color: var(--border-color); }
.composer-context-meter.warn { color: var(--warning); }
.composer-context-meter.danger { color: var(--danger); }
.composer-context-meter:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.composer-context-meter svg { width: 18px; height: 18px; fill: none; stroke-width: 3; flex-shrink: 0; }
.context-meter-track { stroke: var(--border-color); }
.context-meter-fill { stroke: currentColor; }
.context-meter-percent { font-variant-numeric: tabular-nums; white-space: nowrap; }
.context-info { color: var(--text-primary); font-size: var(--font-ui-sm); }
.context-info-heading { display: flex; justify-content: space-between; gap: 12px; }
.context-info-heading strong { font-weight: 500; }
.context-info-summary { margin: 6px 0 12px; font-size: var(--font-section); font-variant-numeric: tabular-nums; }
.context-info-rows { margin: 0; padding-top: 12px; border-top: 1px solid var(--border-color); display: grid; gap: 8px; }
.context-info-rows > div { display: flex; justify-content: space-between; gap: 12px; }
.context-info-rows dt { color: var(--text-secondary); }
.context-info-rows dd { margin: 0; white-space: nowrap; font-variant-numeric: tabular-nums; }
.context-info-source, .context-info-hint { margin: 10px 0 0; line-height: 1.5; font-size: var(--font-caption); color: var(--text-secondary); }
.context-compact-button { margin-top: 12px; width: 100%; }
</style>

<style>
.ai-context-popover.el-popover.el-popper { padding: 14px; border: 1px solid var(--border-color); border-radius: var(--radius-md); background: var(--bg-primary); color: var(--text-primary); box-shadow: var(--shadow-menu); max-height: calc(100vh - 24px); overflow-y: auto; }
</style>
