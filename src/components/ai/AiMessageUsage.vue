<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElPopover } from 'element-plus/es/components/popover/index'
import 'element-plus/es/components/popover/style/css'
import type { AiUsage } from '@shared/types/ai'
import { normalizeAiUsage } from '@shared/aiUsage'
import { useAiInfoPopover } from '@/composables/ai/useAiInfoPopover'
import { formatCompactTokenCount } from '@/utils/ai/tokenCount'
import { usageCacheHitRate } from '@/utils/ai/usagePresentation'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{ usage: AiUsage }>()
const { t, locale } = useI18n()
const usage = computed(() => normalizeAiUsage(props.usage))
const partial = computed(() => usage.value?.usageIncomplete || usage.value?.cacheUsageIncomplete)
const compactLabel = computed(() => usage.value?.totalTokens === undefined
  ? t('ai.usageUnavailable')
  : t('ai.usageCompact', { n: formatCompactTokenCount(usage.value.totalTokens) }))
const numberFormat = computed(() => new Intl.NumberFormat(locale.value))
const percentageFormat = computed(() => new Intl.NumberFormat(locale.value, { style: 'percent', maximumFractionDigits: 1 }))
const detailId = useId()
const triggerRef = ref<HTMLButtonElement | null>(null)
const detailRef = ref<HTMLElement | null>(null)
const { open, show, toggle, hideLater, clearHideTimer, afterHide } = useAiInfoPopover(triggerRef, detailRef)

const count = (value: number | undefined) => value === undefined ? t('ai.usageNotReported') : `${numberFormat.value.format(value)} tok`
const rows = computed(() => {
  const value = usage.value
  if (!value) return []
  const hitRate = usageCacheHitRate(value)
  return [
    { label: t('ai.usageDetails.input'), value: count(value.promptTokens) },
    { label: t('ai.usageDetails.cacheHitRate'), value: hitRate === undefined ? t('ai.usageNotReported') : percentageFormat.value.format(hitRate) },
    { label: t('ai.usageDetails.uncached'), value: count(value.uncachedPromptTokens) },
    { label: t('ai.usageDetails.cacheRead'), value: count(value.cachedPromptTokens) },
    ...(value.cacheCreationPromptTokens !== undefined ? [{ label: t('ai.usageDetails.cacheWrite'), value: count(value.cacheCreationPromptTokens) }] : []),
    { label: t('ai.usageDetails.output'), value: count(value.completionTokens) },
    ...(value.reasoningTokens !== undefined ? [{ label: t('ai.usageDetails.reasoning'), value: count(value.reasoningTokens) }] : []),
    ...(value.requestCount ? [{ label: t('ai.usageDetails.requests'), value: numberFormat.value.format(value.requestCount) }] : []),
  ]
})
</script>

<template>
  <ElPopover
    v-if="usage" :visible="open" placement="top-start" :width="300" :show-arrow="false"
    :persistent="false" :teleported="true" :trigger-keys="[]" :offset="8"
    popper-class="ai-usage-popover" :popper-style="{ maxWidth: 'calc(100vw - 24px)' }"
    @after-leave="afterHide"
  >
    <template #reference>
      <span class="usage-trigger">
        <button
          ref="triggerRef" type="button" class="usage-line" :class="{ 'is-open': open }"
          :aria-label="`${compactLabel}，${t('ai.usageDetails.show')}${partial ? `，${t('ai.usagePartial')}` : ''}`"
          :aria-expanded="open" :aria-controls="open ? detailId : undefined"
          @mouseenter="show" @mouseleave="hideLater" @click="toggle"
        >
          <AppIcon name="database" size="xs" />
          <span>{{ compactLabel }}</span>
          <span v-if="partial" class="usage-partial" :aria-label="t('ai.usagePartial')">*</span>
        </button>
      </span>
    </template>
    <section :id="detailId" ref="detailRef" class="usage-details" :aria-label="t('ai.usageDetails.title')" @mouseenter="clearHideTimer" @mouseleave="hideLater">
      <header class="usage-heading">
        <span class="usage-heading-label"><AppIcon name="database" size="sm" />{{ t('ai.usageDetails.title') }}</span>
        <strong>{{ count(usage.totalTokens) }}</strong>
      </header>
      <dl class="usage-rows">
        <div v-for="row in rows" :key="row.label" class="usage-row"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></div>
      </dl>
      <p v-if="usage.usageIncomplete" class="usage-note usage-incomplete">{{ t('ai.usagePartialHint') }}</p>
      <p v-if="usage.cacheUsageIncomplete" class="usage-note usage-incomplete">{{ t('ai.usageCachePartialHint') }}</p>
      <p class="usage-note">{{ t('ai.usageAccountingHint') }}</p>
    </section>
  </ElPopover>
</template>

<style scoped>
.usage-trigger { display: inline-flex; flex: 0 0 auto; }
.usage-line {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  gap: 4px;
  padding: 3px 6px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font: inherit;
  font-size: var(--font-caption);
  line-height: 1.3;
  white-space: nowrap;
  cursor: pointer;
  font-variant-numeric: tabular-nums;
}
.usage-line:hover, .usage-line.is-open { border-color: var(--border-color); color: var(--text-primary); }
.usage-line:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.usage-partial { color: var(--warning); }
.usage-details { font-size: var(--font-ui-sm); color: var(--text-primary); }
.usage-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding-bottom: 10px; border-bottom: 1px solid var(--border-color); }
.usage-heading-label { display: inline-flex; align-items: center; gap: 6px; }
.usage-heading strong { font-weight: 500; white-space: nowrap; font-variant-numeric: tabular-nums; }
.usage-rows { display: grid; gap: 8px; margin: 12px 0; }
.usage-row { display: flex; justify-content: space-between; gap: 12px; }
.usage-row dt { color: var(--text-secondary); }
.usage-row dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.usage-note { margin: 8px 0 0; color: var(--text-secondary); font-size: var(--font-caption); line-height: 1.5; }
.usage-incomplete { color: var(--warning); }
</style>

<style>
.ai-usage-popover.el-popover.el-popper {
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-primary);
  color: var(--text-primary);
  box-shadow: var(--shadow-menu);
  max-height: calc(100vh - 24px);
  overflow-y: auto;
}
</style>
