<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import AppIcon from '@/components/icons/AppIcon.vue'
import { appConfirm } from '@/composables/app/useAppDialog'
import { MCP_TOKEN_ENV_VAR, type ApprovalMode, type McpClientId, type McpHttpStatus } from '@shared/mcp/types'
import { MCP_HTTP_DEFAULT_PORT } from '@shared/mcp/limits'
import {
  MCP_DESTRUCTIVE_BINARY_NAMES,
  MCP_INTERPRETER_NAMES,
  MCP_PRIVILEGE_WRAPPER_NAMES,
} from '@shared/mcp/classify'

const { t } = useI18n()

const mcpStatus = ref<McpHttpStatus | null>(null)
const mcpLoading = ref(true)
const mcpBusy = ref(false)
const mcpPortDraft = ref(MCP_HTTP_DEFAULT_PORT)
const selectedClient = ref<McpClientId>('claudeCode')
const clients = {
  claudeCode: { name: 'Claude Code', path: '.mcp.json' },
  codex: { name: 'Codex', path: '~/.codex/config.toml' },
  cursor: { name: 'Cursor', path: '~/.cursor/mcp.json' },
  geminiCli: { name: 'Gemini CLI', path: '~/.gemini/settings.json' },
  copilot: { name: 'GitHub Copilot', path: '~/.copilot/mcp-config.json' },
  openCode: { name: 'OpenCode', path: 'opencode.json' },
  generic: { name: '', path: '' },
} satisfies Record<McpClientId, { name: string; path: string }>

const clientConfigPath = computed(() => clients[selectedClient.value].path)
const clientConfig = computed(() => mcpStatus.value?.snippets[selectedClient.value] ?? '')

const approvalModes: Array<{ id: ApprovalMode; label: string; hint: string }> = [
  { id: 'deny-destructive', label: 'settingsMcp.approvalDeny', hint: 'settingsMcp.approvalDenyHint' },
  { id: 'ask-destructive', label: 'settingsMcp.approvalAsk', hint: 'settingsMcp.approvalAskHint' },
  { id: 'auto', label: 'settingsMcp.approvalAuto', hint: 'settingsMcp.approvalAutoHint' },
]

const dynamicPolicyExamples = [
  { command: 'kill -0 <PID>', result: 'settingsMcp.policyRuleKillProbe' },
  { command: 'systemctl status / start / stop', result: 'settingsMcp.policyRuleSystemctl' },
  { command: 'git clean / reset --hard / push --force', result: 'settingsMcp.policyRuleGit' },
  { command: 'sed -i / find -delete / rsync --delete', result: 'settingsMcp.policyRuleMutationFlags' },
  { command: 'curl / wget', result: 'settingsMcp.policyRuleNetwork' },
  { command: 'docker / podman / kubectl / helm / terraform', result: 'settingsMcp.policyRuleCli' },
  { command: 'sh -c / bash -c / python -c / node -e', result: 'settingsMcp.policyRuleScripts' },
] as const

const highRiskExamples = [
  'rm -rf /',
  'dd … of=/dev/…',
  'curl … | sh',
  'chmod -R … /',
  '> /etc/passwd',
  '… > ~/.ssh/authorized_keys',
]

const activePolicySummary = computed(() => {
  const mode = mcpStatus.value?.approvalMode || 'deny-destructive'
  if (mode === 'auto') {
    return { tone: 'danger', title: t('settingsMcp.policyCurrentAuto'), detail: t('settingsMcp.policyCurrentAutoHint') }
  }
  if (mode === 'ask-destructive') {
    return { tone: 'ask', title: t('settingsMcp.policyCurrentAsk'), detail: t('settingsMcp.policyCurrentAskHint') }
  }
  return { tone: 'deny', title: t('settingsMcp.policyCurrentDeny'), detail: t('settingsMcp.policyCurrentDenyHint') }
})

async function refreshMcpStatus() {
  mcpLoading.value = true
  try {
    const st = await window.LiteConnect.mcpGetHttpStatus()
    mcpStatus.value = st
    mcpPortDraft.value = st.port
  } catch {
    mcpStatus.value = null
  } finally {
    mcpLoading.value = false
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success(t('common.copied'))
  } catch {
    ElMessage.error(t('common.copyFailed'))
  }
}

async function toggleMcp() {
  if (!mcpStatus.value || mcpBusy.value) return
  const next = !mcpStatus.value.enabled
  if (next) {
    try {
      await appConfirm({
        title: t('settingsMcp.enableTitle'),
        message: t('settingsMcp.enableMessage'),
        confirmText: t('settingsMcp.enableConfirm'),
        tone: 'warning',
      })
    } catch {
      return
    }
  }
  mcpBusy.value = true
  try {
    mcpStatus.value = await window.LiteConnect.mcpSetHttpEnabled(next)
    mcpPortDraft.value = mcpStatus.value.port
  } catch (err: any) {
    ElMessage.error(
      t('settingsMcp.startFailed', {
        error: typeof err?.message === 'string' ? err.message : String(err),
      }),
    )
    await refreshMcpStatus()
  } finally {
    mcpBusy.value = false
  }
}

async function setApprovalMode(mode: ApprovalMode) {
  if (!mcpStatus.value || mcpBusy.value || mcpStatus.value.approvalMode === mode) return
  mcpBusy.value = true
  try {
    mcpStatus.value = await window.LiteConnect.mcpSetApprovalMode(mode)
  } catch (err: any) {
    ElMessage.error(
      t('settingsMcp.startFailed', {
        error: typeof err?.message === 'string' ? err.message : String(err),
      }),
    )
    await refreshMcpStatus()
  } finally {
    mcpBusy.value = false
  }
}

async function applyMcpPort() {
  if (mcpBusy.value) return
  const port = Math.max(1024, Math.min(65535, Math.round(Number(mcpPortDraft.value)) || MCP_HTTP_DEFAULT_PORT))
  mcpBusy.value = true
  try {
    mcpStatus.value = await window.LiteConnect.mcpSetHttpPort(port)
    mcpPortDraft.value = mcpStatus.value.port
  } catch (err: any) {
    ElMessage.error(
      t('settingsMcp.startFailed', {
        error: typeof err?.message === 'string' ? err.message : String(err),
      }),
    )
    await refreshMcpStatus()
  } finally {
    mcpBusy.value = false
  }
}

async function rotateMcpToken() {
  if (mcpBusy.value) return
  try {
    await appConfirm({
      title: t('settingsMcp.rotateTitle'),
      message: t('settingsMcp.rotateMessage'),
      confirmText: t('settingsMcp.rotateConfirm'),
      tone: 'warning',
    })
  } catch {
    return
  }
  mcpBusy.value = true
  try {
    mcpStatus.value = await window.LiteConnect.mcpRotateHttpToken()
  } finally {
    mcpBusy.value = false
  }
}

const shareCard = computed(() => {
  const st = mcpStatus.value
  if (!st) return ''
  const health = st.url.replace(/\/mcp\/?$/, '/health')
  return t('settingsMcp.shareCard', { url: st.url, token: st.token, health })
})

const authHeader = computed(() => {
  const token = mcpStatus.value?.token
  return token ? `Authorization: Bearer ${token}` : ''
})

const agentPrompt = computed(() => {
  const st = mcpStatus.value
  if (!st?.url || !st.token) return ''
  return t('settingsMcp.agentPrompt', { url: st.url, token: st.token })
})

onMounted(() => {
  void refreshMcpStatus()
})
</script>

<template>
  <section class="mcp-workspace" aria-labelledby="mcp-title">
    <header class="mcp-header">
      <h1 id="mcp-title">{{ t('settingsMcp.title') }}</h1>
      <p>{{ t('settingsMcp.intro') }}</p>
    </header>
    <div class="mcp-grid">
      <div class="mcp-controls">
        <section class="mcp-section" aria-labelledby="mcp-service">
          <div class="mcp-service-row">
            <h2 id="mcp-service">{{ t('settingsMcp.service') }}</h2>
            <button
              type="button"
              role="switch"
              class="mcp-switch"
              aria-labelledby="mcp-service"
              :aria-checked="!!mcpStatus?.enabled"
              :disabled="mcpBusy || !mcpStatus"
              @click="toggleMcp"
            />
          </div>
          <div class="mcp-status" :class="{ warn: !!mcpStatus?.lastError }" role="status">
            <template v-if="mcpStatus">
              <span>{{ mcpStatus.enabled ? t('settingsMcp.enabled') : t('settingsMcp.disabled') }}</span>
              <span v-if="mcpStatus.listening">{{ t('settingsMcp.listening', { url: mcpStatus.url }) }}</span>
              <span v-else-if="mcpStatus.lastError">{{ t('settingsMcp.startFailed', { error: mcpStatus.lastError }) }}</span>
              <span v-else>{{ t('settingsMcp.stopped') }}</span>
            </template>
            <span v-else-if="mcpLoading">{{ t('settingsMcp.loading') }}</span>
            <template v-else>
              <span>{{ t('settingsMcp.loadFailed') }}</span>
              <button type="button" class="ui-btn ui-btn-xs" @click="refreshMcpStatus">{{ t('settings.retryLoad') }}</button>
            </template>
          </div>
          <p class="mcp-hint">{{ t('settingsMcp.hint') }}</p>
          <label class="mcp-label" for="mcp-port">{{ t('settingsMcp.port') }}</label>
          <div class="mcp-field-row">
            <input id="mcp-port" v-model.number="mcpPortDraft" class="ui-input mcp-port-input" type="number" min="1024" max="65535" />
            <button type="button" class="ui-btn" :disabled="mcpBusy || !mcpStatus" @click="applyMcpPort">
              {{ t('settingsMcp.applyPort') }}
            </button>
          </div>
          <label class="mcp-label" for="mcp-token">{{ t('settingsMcp.token') }}</label>
          <div class="mcp-field-row">
            <input id="mcp-token" class="ui-input mcp-token-input" type="text" readonly :value="mcpStatus?.token || ''" />
            <button type="button" class="ui-btn" :disabled="!mcpStatus?.token" @click="mcpStatus && copyText(mcpStatus.token)">
              {{ t('settingsMcp.copyToken') }}
            </button>
            <button type="button" class="ui-btn" :disabled="mcpBusy || !mcpStatus" @click="rotateMcpToken">
              {{ t('settingsMcp.rotate') }}
            </button>
          </div>
        </section>

        <section class="mcp-section" aria-labelledby="mcp-approval">
          <h2 id="mcp-approval">{{ t('settingsMcp.approval') }}</h2>
          <p class="mcp-hint">{{ t('settingsMcp.approvalHint') }}</p>
          <div class="mcp-approval-list" role="group" aria-labelledby="mcp-approval">
            <button
              v-for="item in approvalModes"
              :key="item.id"
              type="button"
              class="mcp-approval-option"
              :data-approval-mode="item.id"
              :aria-pressed="mcpStatus?.approvalMode === item.id"
              :disabled="mcpBusy || !mcpStatus"
              @click="setApprovalMode(item.id)"
            >
              <span class="mcp-approval-copy">
                <span class="mcp-approval-title">{{ t(item.label) }}</span>
                <span class="mcp-approval-desc">{{ t(item.hint) }}</span>
              </span>
              <span class="mcp-approval-mark" aria-hidden="true">
                <AppIcon v-if="mcpStatus?.approvalMode === item.id" name="check" size="xs" />
              </span>
            </button>
          </div>
          <details class="command-policy-details">
            <summary>
              <span>{{ t('settingsMcp.policyDetails') }}</span>
              <span class="policy-count">{{ MCP_DESTRUCTIVE_BINARY_NAMES.length }}</span>
            </summary>
            <div class="command-policy-body">
              <div class="active-policy" :data-tone="activePolicySummary.tone">
                <strong>{{ activePolicySummary.title }}</strong>
                <span>{{ activePolicySummary.detail }}</span>
              </div>
              <p class="mcp-hint policy-intro">{{ t('settingsMcp.policyDetailsHint') }}</p>

              <div class="policy-section">
                <div class="policy-section-title">
                  <span>{{ t('settingsMcp.policyDestructive') }}</span>
                  <span>{{ t('settingsMcp.policyItems', { count: MCP_DESTRUCTIVE_BINARY_NAMES.length }) }}</span>
                </div>
                <p class="mcp-hint">{{ t('settingsMcp.policyDestructiveHint') }}</p>
                <div class="command-chip-list">
                  <code v-for="name in MCP_DESTRUCTIVE_BINARY_NAMES" :key="name">{{ name }}</code>
                </div>
              </div>

              <div class="policy-section">
                <div class="policy-section-title">
                  <span>{{ t('settingsMcp.policyPrivileged') }}</span>
                  <span>{{ t('settingsMcp.policyItems', { count: MCP_PRIVILEGE_WRAPPER_NAMES.length }) }}</span>
                </div>
                <p class="mcp-hint">{{ t('settingsMcp.policyPrivilegedHint') }}</p>
                <div class="command-chip-list">
                  <code v-for="name in MCP_PRIVILEGE_WRAPPER_NAMES" :key="name">{{ name }}</code>
                </div>
              </div>

              <div class="policy-section">
                <div class="policy-section-title">
                  <span>{{ t('settingsMcp.policyHighRisk') }}</span>
                </div>
                <p class="mcp-hint">{{ t('settingsMcp.policyHighRiskHint') }}</p>
                <div class="command-chip-list danger">
                  <code v-for="command in highRiskExamples" :key="command">{{ command }}</code>
                </div>
              </div>

              <div class="policy-section">
                <div class="policy-section-title">
                  <span>{{ t('settingsMcp.policyDynamic') }}</span>
                </div>
                <p class="mcp-hint">{{ t('settingsMcp.policyDynamicHint') }}</p>
                <div class="policy-rule-list">
                  <div v-for="rule in dynamicPolicyExamples" :key="rule.command" class="policy-rule">
                    <code>{{ rule.command }}</code>
                    <span>{{ t(rule.result) }}</span>
                  </div>
                  <div class="policy-rule">
                    <code>{{ MCP_INTERPRETER_NAMES.join(' / ') }}</code>
                    <span>{{ t('settingsMcp.policyRuleInterpreters') }}</span>
                  </div>
                  <div class="policy-rule">
                    <code>{{ t('settingsMcp.policyUnknownCommand') }}</code>
                    <span>{{ t('settingsMcp.policyRuleUnknown') }}</span>
                  </div>
                </div>
              </div>
            </div>
          </details>
        </section>
      </div>
      <section class="mcp-section" aria-labelledby="mcp-client">
        <h2 id="mcp-client">{{ t('settingsMcp.anyClient') }}</h2>
        <p class="mcp-hint">{{ t('settingsMcp.anyClientHint') }}</p>
        <dl class="mcp-facts">
          <div>
            <dt>{{ t('settingsMcp.endpoint') }}</dt>
            <dd>{{ mcpStatus?.url || '—' }}</dd>
          </div>
          <div>
            <dt>{{ t('settingsMcp.transport') }}</dt>
            <dd>{{ t('settingsMcp.transportValue') }}</dd>
          </div>
          <div>
            <dt>{{ t('settingsMcp.authHeader') }}</dt>
            <dd>{{ authHeader || '—' }}</dd>
          </div>
        </dl>
        <div class="mcp-field-row">
          <button type="button" class="ui-btn ui-btn-sm" :disabled="!mcpStatus?.url" @click="mcpStatus && copyText(mcpStatus.url)">
            {{ t('settingsMcp.copyUrl') }}
          </button>
          <button type="button" class="ui-btn ui-btn-sm" :disabled="!shareCard" @click="copyText(shareCard)">
            {{ t('settingsMcp.copyShare') }}
          </button>
        </div>
        <label class="mcp-label" for="mcp-client-template">{{ t('settingsMcp.clientTemplate') }}</label>
        <div class="mcp-field-row">
          <select id="mcp-client-template" v-model="selectedClient" class="ui-select ui-select-sm mcp-client-select">
            <option v-for="(client, id) in clients" :key="id" :value="id">
              {{ client.name || t('settingsMcp.genericClient') }}
            </option>
          </select>
          <button type="button" class="ui-btn ui-btn-sm" :disabled="!clientConfig" @click="copyText(clientConfig)">
            {{ t('settingsMcp.copyConfig') }}
          </button>
        </div>
        <p class="mcp-hint">
          {{ clientConfigPath
            ? t('settingsMcp.clientConfigHint', { path: clientConfigPath, env: MCP_TOKEN_ENV_VAR })
            : t('settingsMcp.genericHint') }}
        </p>
        <pre id="mcp-client-config" class="mcp-snippet">{{ clientConfig || '—' }}</pre>
        <p class="mcp-hint mcp-prompt-hint">{{ t('settingsMcp.agentPromptHint') }}</p>
        <pre class="mcp-snippet">{{ agentPrompt || '—' }}</pre>
        <button
          type="button"
          class="ui-btn ui-btn-sm"
          :disabled="!agentPrompt"
          @click="copyText(agentPrompt)"
        >
          {{ t('settingsMcp.copyAgentPrompt') }}
        </button>
      </section>
    </div>
  </section>
</template>

<style scoped>
.mcp-workspace {
  overflow: auto;
  padding: clamp(16px, 3vw, 32px);
  background: var(--bg-primary);
  container: mcp-workspace / inline-size;
}

.mcp-header,
.mcp-grid {
  max-width: 1160px;
  margin-inline: auto;
}

.mcp-header {
  margin-bottom: var(--space-5);
}

.mcp-header h1 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-title);
}

.mcp-header p {
  margin: 0;
  color: var(--text-secondary);
  font-size: var(--font-ui);
}

.mcp-grid,
.mcp-controls {
  display: grid;
  gap: var(--space-4);
  align-items: start;
  min-width: 0;
}

.mcp-section {
  min-width: 0;
  padding: var(--space-4);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg);
  background: var(--bg-secondary);
  container: mcp-section / inline-size;
}

.mcp-section h2 {
  margin: 0;
  font-size: var(--font-section);
}

.mcp-service-row,
.mcp-field-row,
.mcp-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.mcp-service-row { justify-content: space-between; }

.mcp-status,
.mcp-hint,
.mcp-label {
  color: var(--text-secondary);
  font-size: var(--font-ui-sm);
  line-height: var(--line-reading);
}

.mcp-status { margin-top: var(--space-2); overflow-wrap: anywhere; }
.mcp-status.warn { color: var(--warning); }
.mcp-hint { margin: var(--space-2) 0; }
.mcp-label { display: block; margin: var(--space-4) 0 var(--space-2); font-weight: 600; }
.mcp-prompt-hint { margin-top: var(--space-4); }

.mcp-switch {
  display: flex;
  align-items: center;
  width: 40px;
  height: 22px;
  padding: 2px;
  border: 1px solid var(--border-color);
  border-radius: 11px;
  background: var(--bg-primary);
  cursor: pointer;
}

.mcp-switch::before {
  content: '';
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--text-secondary);
}

.mcp-switch[aria-checked='true'] {
  justify-content: flex-end;
  border-color: var(--accent);
  background: var(--accent);
}

.mcp-switch[aria-checked='true']::before { background: #fff; }
.mcp-switch:disabled { opacity: .5; cursor: not-allowed; }

.mcp-port-input {
  width: 120px;
}

.mcp-token-input { flex: 1 1 160px; min-width: 0; }
.mcp-client-select { flex: 1 1 160px; min-width: 0; width: auto; }

.mcp-facts {
  margin: 10px 0 8px;
  display: grid;
  gap: 8px;
}

.mcp-facts > div {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 8px;
  align-items: start;
  font-size: var(--font-ui-sm);
}

.mcp-facts dt {
  margin: 0;
  color: var(--text-secondary);
  font-weight: 600;
}

.mcp-facts dd {
  margin: 0;
  color: var(--text-primary);
  word-break: break-all;
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}

.mcp-approval-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 8px 0 4px;
}

.mcp-approval-option {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--space-3);
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-primary);
  text-align: left;
  cursor: pointer;
}

.mcp-approval-option[aria-pressed='false']:hover:not(:disabled) {
  border-color: color-mix(in srgb, var(--text-primary) 22%, var(--border-color));
  background: var(--tab-hover-surface);
}

.mcp-approval-option:disabled {
  opacity: 0.6;
  cursor: default;
}

.mcp-approval-option[aria-pressed='true'] {
  border-color: color-mix(in srgb, var(--text-primary) 50%, var(--border-color));
  background: color-mix(in srgb, var(--text-primary) 6%, var(--tab-selected-surface));
  box-shadow: var(--tab-selected-shadow);
}

.mcp-approval-copy {
  display: grid;
  gap: var(--space-1);
}

.mcp-approval-mark {
  display: grid;
  place-items: center;
  width: calc(18px * var(--ui-scale));
  height: calc(18px * var(--ui-scale));
  border: 1px solid var(--border-color);
  border-radius: 50%;
}

.mcp-approval-option[aria-pressed='true'] .mcp-approval-mark {
  border-color: var(--text-primary);
  background: var(--text-primary);
  color: var(--bg-primary);
}

.mcp-approval-title {
  font-size: var(--font-ui);
  font-weight: 600;
}

.mcp-approval-desc {
  font-size: var(--font-ui-sm);
  color: var(--text-secondary);
  line-height: 1.4;
}

.command-policy-details {
  margin-top: 10px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--bg-primary);
  overflow: hidden;
}

.command-policy-details > summary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  color: var(--text-primary);
  font-size: var(--font-ui-sm);
  font-weight: 600;
  cursor: pointer;
  user-select: none;
  list-style: none;
}

.command-policy-details > summary::-webkit-details-marker,
.command-policy-details > summary::marker {
  display: none;
}

.command-policy-details > summary::before {
  content: '›';
  color: var(--text-secondary);
  font-size: 18px;
  line-height: 1;
  transition: transform 0.15s ease;
}

.command-policy-details[open] > summary::before {
  transform: rotate(90deg);
}

.policy-count {
  min-width: 22px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: var(--font-caption);
  text-align: center;
}

.command-policy-body {
  padding: 0 12px 12px;
  border-top: 1px solid var(--border-color);
}

.active-policy {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 12px;
  padding: 9px 10px;
  border-radius: 7px;
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
  font-size: var(--font-caption);
  line-height: 1.45;
}

.active-policy strong {
  color: var(--text-primary);
  font-size: var(--font-ui-sm);
}

.active-policy[data-tone='deny'] {
  border-color: color-mix(in srgb, var(--warning) 45%, var(--border-color));
  background: color-mix(in srgb, var(--warning) 8%, transparent);
}

.active-policy[data-tone='ask'] {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border-color));
  background: var(--accent-bg);
}

.active-policy[data-tone='danger'] {
  border-color: color-mix(in srgb, var(--danger) 45%, var(--border-color));
  background: color-mix(in srgb, var(--danger) 8%, transparent);
}

.policy-intro {
  margin-top: 10px;
}

.policy-section {
  margin-top: 14px;
}

.policy-section-title {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-primary);
  font-size: var(--font-ui-sm);
  font-weight: 600;
}

.policy-section-title > span:last-child:not(:first-child) {
  color: var(--text-secondary);
  font-size: var(--font-caption);
  font-weight: 400;
}

.policy-section .mcp-hint {
  margin: 4px 0 7px;
}

.command-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.command-chip-list code,
.policy-rule code {
  border: 1px solid var(--border-color);
  border-radius: 5px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: var(--font-caption);
}

.command-chip-list code {
  padding: 3px 6px;
}

.command-chip-list.danger code {
  color: var(--danger);
}

.policy-rule-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.policy-rule {
  display: grid;
  gap: 8px;
  align-items: start;
  font-size: var(--font-caption);
  line-height: 1.45;
  color: var(--text-secondary);
}

.policy-rule code {
  padding: 4px 6px;
  overflow-wrap: anywhere;
}

@container mcp-section (min-width: 460px) {
  .policy-rule {
    grid-template-columns: minmax(180px, 0.8fr) minmax(220px, 1.2fr);
  }
}

@container mcp-workspace (min-width: 880px) {
  .mcp-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
}

.mcp-snippet {
  margin: 0 0 8px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  color: var(--text-secondary);
  font-size: var(--font-caption);
  line-height: 1.45;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
