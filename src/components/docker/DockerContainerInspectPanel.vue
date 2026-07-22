<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  buildInspectSegments,
  findInspectMatches,
  inspectMatchDisplay,
  nextInspectMatchIndex,
  prevInspectMatchIndex,
} from '../../composables/inspectJsonSearch'
import type { DockerContainerInspectResult } from '../../env.d'

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
      <input
        class="search-input inspect-search"
        type="search"
        v-model="inspectSearch"
        :placeholder="t('docker.detail.inspectSearch')"
        :aria-label="t('docker.detail.inspectSearch')"
      />
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
          class="docker-btn ghost compact"
          :disabled="!inspectMatches.length"
          :title="t('docker.detail.inspectPrevMatch')"
          :aria-label="t('docker.detail.inspectPrevMatch')"
          @click="goPrevInspectMatch"
        >
          ↑
        </button>
        <button
          type="button"
          class="docker-btn ghost compact"
          :disabled="!inspectMatches.length"
          :title="t('docker.detail.inspectNextMatch')"
          :aria-label="t('docker.detail.inspectNextMatch')"
          @click="goNextInspectMatch"
        >
          ↓
        </button>
      </div>
      <button
        type="button"
        class="docker-btn"
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

.inspect-search {
  flex: 1;
  min-width: 140px;
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
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre;
  user-select: text;
}

.inspect-hit {
  background: color-mix(in srgb, var(--warning, #d29922) 35%, transparent);
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
  color: var(--danger, #f85149);
}

.docker-btn {
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 12px;
  cursor: pointer;
}

.docker-btn.ghost {
  background: transparent;
}

.docker-btn.compact {
  padding: 2px 8px;
  min-width: 28px;
}

.docker-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.search-input {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  color: var(--text-primary);
  padding: 6px 10px;
  font-size: 12px;
}
</style>
