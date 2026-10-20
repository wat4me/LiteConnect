<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AiToolRun } from '@shared/types/ai'
import { useAiChat } from '@/composables/ai/useAiChat'
import { splitToolReason } from '@/utils/ai/toolReason'
import { formatToolRunDisplay } from '@shared/aiToolRunDisplay'
import { useAiToolNameLabel } from '@/composables/ai/useAiToolNameLabel'
import { diffPreviewRows } from '@/utils/ai/diffPreviewRows'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{ sessionId: string; runs: AiToolRun[] }>()
const { t } = useI18n()
const { resolveToolApproval } = useAiChat()
const visibleApprovals = computed(() => props.runs.slice(0, 1))
const resolvingApprovalIds = ref<Set<string>>(new Set())

function isApprovalResolving(runId: string): boolean {
  return resolvingApprovalIds.value.has(runId)
}

async function handleToolApproval(runId: string, approved: boolean): Promise<void> {
  if (isApprovalResolving(runId)) return
  resolvingApprovalIds.value = new Set(resolvingApprovalIds.value).add(runId)
  try {
    await resolveToolApproval(props.sessionId, runId, approved)
  } finally {
    const next = new Set(resolvingApprovalIds.value)
    next.delete(runId)
    resolvingApprovalIds.value = next
  }
}

function approvalHint(run: AiToolRun): string {
  return formatToolRunDisplay(run).hint
}

function approvalRiskLabel(risk?: AiToolRun['risk']): string {
  if (risk === 'read') return t('ai.toolRiskRead')
  if (risk === 'write' || risk === 'destructive') return t('ai.toolRiskWrite')
  if (risk === 'privileged') return t('ai.toolRiskPrivileged')
  if (risk === 'forbidden') return t('ai.toolRiskForbidden')
  return ''
}

function approvalCopy(run: AiToolRun): string {
  if (run.risk === 'destructive' || run.risk === 'privileged' || run.risk === 'forbidden') {
    return t('ai.toolAskDanger')
  }
  return t('ai.toolAskHint')
}

const toolNameLabel = useAiToolNameLabel()

</script>

<template>
    <div v-if="runs.length" class="tool-approval-stack">
      <div
        v-for="run in visibleApprovals"
        :key="run.id"
        class="tool-approval"
        :class="{ danger: run.risk === 'destructive' || run.risk === 'privileged' || run.risk === 'forbidden' }"
      >
        <div class="tool-approval-head">
          <span v-if="run.target" class="tool-approval-target">{{ run.target }}</span>
          <span class="tool-approval-name">{{ toolNameLabel(run.name) }}</span>
          <span v-if="approvalRiskLabel(run.risk)" class="tool-approval-risk" :data-risk="run.risk">{{ approvalRiskLabel(run.risk) }}</span>
          <span class="tool-approval-copy">{{ approvalCopy(run) }}</span>
        </div>
        <p v-if="splitToolReason(run.reason).explanation" class="tool-approval-reason"><strong>{{ t('ai.toolExplanationLabel') }}</strong>{{ splitToolReason(run.reason).explanation }}</p>
        <p v-if="splitToolReason(run.reason).notice" class="tool-approval-reason tool-policy-notice"><strong>{{ t('ai.toolPolicyNoticeLabel') }}</strong>{{ splitToolReason(run.reason).notice }}</p>
        <details v-if="approvalHint(run) || run.diffSummary || run.diffPreview" class="tool-approval-details" open>
          <summary>
            <AppIcon name="chevron-right" size="xs" class="details-chevron" />
            <span>{{ t('ai.toolApprovalDetails') }}</span>
            <span v-if="run.diffSummary" class="tool-approval-diff-summary">{{ run.diffSummary }}</span>
          </summary>
          <div class="tool-approval-details-body">
            <pre v-if="approvalHint(run)" class="tool-approval-hint" :title="approvalHint(run)">{{ approvalHint(run) }}</pre>
            <div v-if="run.diffPreview" class="tool-approval-diff">
              <pre class="tool-approval-diff-body"><span
                v-for="(row, i) in diffPreviewRows(run.diffPreview)"
                :key="i"
                class="diff-row"
                :class="`diff-${row.kind}`"
              >{{ row.text }}</span></pre>
            </div>
          </div>
        </details>
        <div class="tool-approval-actions">
          <button type="button" class="tool-approval-btn" :disabled="isApprovalResolving(run.id)" @click="handleToolApproval(run.id, false)">{{ t('ai.toolDeny') }}</button>
          <button
            type="button"
            class="tool-approval-btn primary"
            :disabled="isApprovalResolving(run.id)"
            @click="handleToolApproval(run.id, true)"
          >
            {{ t('ai.toolAllow') }}
          </button>
        </div>
      </div>
      <div v-if="runs.length > 1" class="tool-approval-queued">
        {{ t('ai.toolApprovalQueued', { n: runs.length - 1 }) }}
      </div>
    </div>

</template>

<style scoped src="./AiToolApprovals.css"></style>
