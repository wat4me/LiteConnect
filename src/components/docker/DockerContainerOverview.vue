<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { formatCreated, formatInspectTime, formatPortChip } from './dockerUiHelpers'
import type { DockerContainerInspectResult, DockerContainerSummary } from '../../env.d'

const props = defineProps<{
  container: DockerContainerSummary
  inspectResult: DockerContainerInspectResult | null
  inspectLoading: boolean
  inspectError: string | null
}>()

const { t } = useI18n()

function stateLabel(state: string): string {
  const s = (state || '').toLowerCase()
  if (s === 'running') return t('docker.containerState.running')
  if (s === 'exited') return t('docker.containerState.exited')
  if (s === 'created') return t('docker.containerState.created')
  if (s === 'dead') return t('docker.containerState.dead')
  if (s === 'paused') return t('docker.containerState.paused')
  if (s === 'restarting') return t('docker.containerState.restarting')
  if (s === 'removing') return t('docker.containerState.removing')
  return state || t('docker.containerState.unknown')
}
</script>

<template>
  <div class="detail-body">
    <div v-if="inspectLoading && !inspectResult" class="detail-loading">
      {{ t('docker.detail.loading') }}
    </div>
    <div v-else-if="inspectError && !inspectResult" class="detail-error">
      {{ t('docker.detail.inspectFailed') }}
      <span class="list-error-detail">{{ inspectError }}</span>
    </div>
    <div v-else-if="inspectResult" class="overview-sections">
      <section class="ov-section">
        <h4 class="ov-section-title">{{ t('docker.detail.sections.basic') }}</h4>
        <dl class="overview-grid">
          <div class="ov-row">
            <dt>{{ t('docker.detail.fields.id') }}</dt>
            <dd class="mono selectable truncate" :title="inspectResult.overview.id">
              {{ inspectResult.overview.id || '—' }}
            </dd>
          </div>
          <div class="ov-row">
            <dt>{{ t('docker.detail.fields.name') }}</dt>
            <dd class="truncate" :title="inspectResult.overview.displayName">
              {{ inspectResult.overview.displayName || '—' }}
            </dd>
          </div>
          <div class="ov-row">
            <dt>{{ t('docker.detail.fields.image') }}</dt>
            <dd class="truncate" :title="inspectResult.overview.image || undefined">
              {{ inspectResult.overview.image || '—' }}
            </dd>
          </div>
          <div class="ov-row">
            <dt>{{ t('docker.detail.fields.status') }}</dt>
            <dd>
              {{ stateLabel(inspectResult.overview.state.status) }}
              <span v-if="container.status" class="ov-status-sub">
                · {{ container.status }}
              </span>
            </dd>
          </div>
          <div class="ov-row">
            <dt>{{ t('docker.detail.fields.created') }}</dt>
            <dd>
              {{
                formatInspectTime(inspectResult.overview.created) !== '—'
                  ? formatInspectTime(inspectResult.overview.created)
                  : formatCreated(container.created)
              }}
            </dd>
          </div>
          <div class="ov-row">
            <dt>{{ t('docker.detail.fields.started') }}</dt>
            <dd>{{ formatInspectTime(inspectResult.overview.state.startedAt) }}</dd>
          </div>
          <div class="ov-row">
            <dt>{{ t('docker.detail.fields.restartPolicy') }}</dt>
            <dd>{{ inspectResult.overview.restartPolicy || '—' }}</dd>
          </div>
        </dl>
      </section>
      <section class="ov-section">
        <h4 class="ov-section-title">{{ t('docker.detail.sections.network') }}</h4>
        <dl class="overview-grid">
          <div class="ov-row">
            <dt>{{ t('docker.detail.fields.networks') }}</dt>
            <dd class="wrap">
              {{ inspectResult.overview.networks.join(', ') || '—' }}
            </dd>
          </div>
          <div class="ov-row">
            <dt>{{ t('docker.detail.fields.ports') }}</dt>
            <dd>
              <div v-if="inspectResult.overview.ports.length" class="port-chips">
                <span
                  v-for="(p, i) in inspectResult.overview.ports"
                  :key="i"
                  class="port-chip"
                  :title="formatPortChip(p)"
                >{{ formatPortChip(p) }}</span>
              </div>
              <span v-else>{{ t('docker.list.noPorts') }}</span>
            </dd>
          </div>
        </dl>
      </section>
      <section class="ov-section">
        <h4 class="ov-section-title">{{ t('docker.detail.sections.mounts') }}</h4>
        <ul v-if="inspectResult.overview.mounts.length" class="mount-list">
          <li
            v-for="(m, i) in inspectResult.overview.mounts"
            :key="i"
            class="mount-item"
            :title="`${m.source || m.name || m.type || '—'} → ${m.destination || '—'}`"
          >
            <span class="mount-src" :title="m.source || m.name || m.type || undefined">
              {{ m.source || m.name || m.type || '—' }}
            </span>
            <span class="mount-arrow" aria-hidden="true">→</span>
            <span class="mount-dst" :title="m.destination || undefined">
              {{ m.destination || '—' }}
            </span>
          </li>
        </ul>
        <p v-else class="ov-empty">{{ t('docker.detail.noMounts') }}</p>
      </section>
    </div>
    <div v-else class="overview-sections">
      <section class="ov-section">
        <h4 class="ov-section-title">{{ t('docker.detail.sections.basic') }}</h4>
        <dl class="overview-grid">
          <div class="ov-row">
            <dt>{{ t('docker.detail.fields.id') }}</dt>
            <dd class="mono selectable truncate" :title="container.id">
              {{ container.id }}
            </dd>
          </div>
          <div class="ov-row">
            <dt>{{ t('docker.detail.fields.image') }}</dt>
            <dd class="truncate" :title="container.image || undefined">
              {{ container.image || '—' }}
            </dd>
          </div>
          <div class="ov-row">
            <dt>{{ t('docker.detail.fields.created') }}</dt>
            <dd>{{ formatCreated(container.created) }}</dd>
          </div>
        </dl>
      </section>
      <section class="ov-section">
        <h4 class="ov-section-title">{{ t('docker.detail.sections.network') }}</h4>
        <dl class="overview-grid">
          <div class="ov-row">
            <dt>{{ t('docker.detail.fields.ports') }}</dt>
            <dd>
              <div v-if="container.ports.length" class="port-chips">
                <span
                  v-for="(p, i) in container.ports"
                  :key="i"
                  class="port-chip"
                  :title="formatPortChip(p)"
                >{{ formatPortChip(p) }}</span>
              </div>
              <span v-else>{{ t('docker.list.noPorts') }}</span>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  </div>
</template>

<style scoped>
@import './dockerShared.css';

.detail-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 14px;
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

.list-error-detail {
  display: block;
  margin-top: 6px;
  font-size: 12px;
  opacity: 0.85;
}

.overview-sections {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.ov-section-title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.overview-grid {
  margin: 0;
  display: grid;
  gap: 6px;
}

.ov-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 8px;
  font-size: 12px;
  align-items: start;
}

.ov-row dt {
  color: var(--text-secondary);
  margin: 0;
}

.ov-row dd {
  margin: 0;
  color: var(--text-primary);
  min-width: 0;
}

.ov-row dd.mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}

.ov-row dd.selectable {
  user-select: text;
}

.ov-row dd.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ov-row dd.wrap {
  white-space: normal;
  word-break: break-word;
}

.ov-status-sub {
  color: var(--text-secondary);
}

.port-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.port-chip {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.mount-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mount-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 6px;
  font-size: 11px;
  align-items: center;
}

.mount-src,
.mount-dst {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.mount-arrow {
  color: var(--text-secondary);
}

.ov-empty {
  margin: 0;
  font-size: 12px;
  color: var(--text-secondary);
}
</style>
