<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  buildInspectSegments,
  findInspectMatches,
  inspectMatchDisplay,
  nextInspectMatchIndex,
  prevInspectMatchIndex,
} from '../../composables/docker/inspectJsonSearch'
import type { DockerContainerInspectResult } from '../../env.d'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{
  inspectResult: DockerContainerInspectResult | null
  inspectLoading: boolean
  inspectError: string | null
  active: boolean
  selectedId: string | null
}>()

const { t } = useI18n()
const inspectPreEl = ref<HTMLElement | null>(null)
const inspectSearch = ref('')
const inspectActiveMatch = ref(0)
const copyFeedback = ref<'idle' | 'ok' | 'fail'>('idle')
let copyTimer: ReturnType<typeof setTimeout> | null = null

const inspectJsonText = computed(() => props.inspectResult?.inspectJson || '')

const inspectMatches = computed(() =>
  findInspectMatches(inspectJsonText.value, inspectSearch.value),
)

const inspectSegments = computed(() =>
  buildInspectSegments(inspectJsonText.value, inspectMatches.value),
)

const inspectMatchUi = computed(() =>
  inspectMatchDisplay(inspectActiveMatch.value, inspectMatches.value.length),
)

const hasInspectQuery = computed(() => inspectSearch.value.trim().length > 0)

watch(
  () => [inspectSearch.value, props.inspectResult?.inspectJson, props.selectedId] as const,
  () => {
    inspectActiveMatch.value = 0
  },
)

watch(
  () => [inspectActiveMatch.value, inspectMatches.value.length, props.active] as const,
  async () => {
    if (!props.active) return
    if (!inspectMatches.value.length) return
    await nextTick()
    const el = inspectPreEl.value?.querySelector(
      `[data-inspect-match="${inspectActiveMatch.value}"]`,
    ) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  },
)

function goPrevInspectMatch() {
  inspectActiveMatch.value = prevInspectMatchIndex(
    inspectActiveMatch.value,
    inspectMatches.value.length,
  )
}

function goNextInspectMatch() {
  inspectActiveMatch.value = nextInspectMatchIndex(
    inspectActiveMatch.value,
    inspectMatches.value.length,
  )
}

async function copyInspectJson() {
  const text = props.inspectResult?.inspectJson || ''
  if (!text) return
  try {
    await window.LiteConnect.clipboardWriteText(text)
    copyFeedback.value = 'ok'
  } catch {
    copyFeedback.value = 'fail'
  }
  if (copyTimer) clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copyFeedback.value = 'idle'
    copyTimer = null
  }, 2000)
}

function resetSearch() {
  inspectSearch.value = ''
  inspectActiveMatch.value = 0
}

defineExpose({ resetSearch })
</script>

<template>
  <div class="detail-body inspect-body">
    <div class="inspect-toolbar">
      <div class="inspect-search-field">
        <input
          v-model="inspectSearch"
          class="ui-input ui-input-sm inspect-search"
          type="text"
          :placeholder="t('docker.detail.inspectSearch')"
          :aria-label="t('docker.detail.inspectSearch')"
        />
        <button
          v-if="inspectSearch"
          type="button"
          class="ui-icon-btn ui-icon-btn-sm ui-icon-btn-ghost ui-icon-btn-close inspect-search-clear"
          :title="t('common.clear')"
          :aria-label="t('common.clear')"
          @click="inspectSearch = ''"
        >
          <AppIcon name="close" size="xs" />
        </button>
      </div>
      <div v-if="hasInspectQuery" class="inspect-nav" aria-live="polite">
        <span class="inspect-count">
          {{
            inspectMatches.length
              ? t('docker.detail.inspectMatchCount', {
                  current: inspectMatchUi.current,
                  total: inspectMatchUi.total,
                })
              : t('docker.detail.inspectNoMatch')
          }}
        </span>
        <button
          type="button"
          class="ui-icon-btn ui-icon-btn-sm ui-icon-btn-ghost"
          :disabled="!inspectMatches.length"
          :title="t('docker.detail.inspectPrevMatch')"
          :aria-label="t('docker.detail.inspectPrevMatch')"
          @click="goPrevInspectMatch"
        >
          <AppIcon name="chevron-up" size="xs" />
        </button>
        <button
          type="button"
          class="ui-icon-btn ui-icon-btn-sm ui-icon-btn-ghost"
          :disabled="!inspectMatches.length"
          :title="t('docker.detail.inspectNextMatch')"
          :aria-label="t('docker.detail.inspectNextMatch')"
          @click="goNextInspectMatch"
        >
          <AppIcon name="chevron-down" size="xs" />
        </button>
      </div>
      <button
        type="button"
        class="ui-btn ui-btn-sm"
        :disabled="!inspectResult?.inspectJson"
        @click="copyInspectJson"
      >
        {{
          copyFeedback === 'ok'
            ? t('docker.detail.copied')
            : copyFeedback === 'fail'
              ? t('docker.detail.copyFailed')
              : t('docker.detail.copyJson')
        }}
      </button>
    </div>
    <div v-if="inspectLoading && !inspectResult" class="detail-loading">
      {{ t('docker.detail.loading') }}
    </div>
    <div v-else-if="inspectError && !inspectResult" class="detail-error">
      {{ t('docker.detail.inspectFailed') }}
    </div>
    <pre
      v-else-if="inspectResult"
      ref="inspectPreEl"
      class="inspect-pre"
    ><template v-for="(seg, i) in inspectSegments" :key="i"><span
        v-if="seg.kind === 'match'"
        class="inspect-hit"
        :class="{ active: seg.matchIndex === inspectActiveMatch }"
        :data-inspect-match="seg.matchIndex"
      >{{ seg.text }}</span><span v-else>{{ seg.text }}</span></template></pre>
  </div>
</template>

<style scoped>
@import './dockerShared.css';

.detail-body.inspect-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 10px 12px;
  gap: 8px;
}

.inspect-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.inspect-search-field {
  position: relative;
  flex: 1;
  min-width: 140px;
}

.inspect-search {
  width: 100%;
  padding-right: 34px;
}

.inspect-search-clear {
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  width: 24px !important;
  height: 24px !important;
}

.inspect-nav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.inspect-count {
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.inspect-pre {
  flex: 1;
  min-height: 0;
  overflow: auto;
  margin: 0;
  padding: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-tertiary);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: 11px;
  line-height: 1.45;
  white-space: pre;
  user-select: text;
}

.inspect-hit {
  background: color-mix(in srgb, var(--warning) 35%, transparent);
}

.inspect-hit.active {
  outline: 1px solid color-mix(in srgb, var(--accent) 55%, transparent);
  background: color-mix(in srgb, var(--accent) 28%, transparent);
}

.detail-loading,
.detail-error {
  padding: 16px 4px;
  font-size: 13px;
  color: var(--text-secondary);
}

.detail-error {
  color: var(--danger);
}
</style>
