<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DbEngine, DbSslOptions } from '../../env.d'
import AppIcon from '../icons/AppIcon.vue'
import type { ConnectionFormModel } from '@/domain/database/types'
import {
  ADVANCED_OPTION_KEYS,
  buildDbConnectionUrl,
  parseDbConnectionUrl,
  type DbUrlEngine,
} from '../../../shared/dbConnectionUrl'

const { t } = useI18n()

const ENGINE_META: Record<
  DbEngine,
  { label: string; defaultPort: number; defaultUser: string; badgeClass: string }
> = {
  mysql: { label: 'MySQL', defaultPort: 3306, defaultUser: 'root', badgeClass: 'mysql' },
  postgres: { label: 'PostgreSQL', defaultPort: 5432, defaultUser: 'postgres', badgeClass: 'postgres' },
  oracle: { label: 'Oracle', defaultPort: 1521, defaultUser: 'system', badgeClass: 'oracle' },
}

export type { ConnectionFormModel }

const props = defineProps<{
  modelValue: ConnectionFormModel
  editing: boolean
  saving: boolean
  testing: boolean
  testHint: string
  sshConnections: Array<{ id: string; name: string; host: string; port: number; username: string }>
  groups: string[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: ConnectionFormModel]
  close: []
  save: []
  test: []
}>()

const formTab = ref<'main' | 'ssh' | 'ssl' | 'advanced'>('main')
const showPassword = ref(false)
const urlImport = ref('')
const urlImportHint = ref('')
const extraRows = ref<Array<{ key: string; value: string }>>([{ key: '', value: '' }])

const form = computed({
  get: () => props.modelValue,
  set: (v) => emit('update:modelValue', v),
})

function patch<K extends keyof ConnectionFormModel>(key: K, value: ConnectionFormModel[K]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function patchSsl<K extends keyof DbSslOptions>(key: K, value: DbSslOptions[K]) {
  const sslOptions = { ...(props.modelValue.sslOptions || {}), [key]: value }
  if (key === 'enabled') {
    emit('update:modelValue', {
      ...props.modelValue,
      ssl: !!value,
      sslOptions: { ...sslOptions, enabled: !!value },
    })
    return
  }
  emit('update:modelValue', { ...props.modelValue, sslOptions })
}

function onEngineChange(engine: DbEngine) {
  const meta = ENGINE_META[engine]
  const prev = ENGINE_META[props.modelValue.engine]
  const next: ConnectionFormModel = {
    ...props.modelValue,
    engine,
  }
  if (props.modelValue.port === prev.defaultPort) {
    next.port = meta.defaultPort
  }
  if (props.modelValue.username === prev.defaultUser || !props.modelValue.username) {
    next.username = meta.defaultUser
  }
  emit('update:modelValue', next)
}

const engineMeta = computed(() => ENGINE_META[props.modelValue.engine] || ENGINE_META.mysql)

const selectedSsh = computed(() =>
  props.sshConnections.find((c) => c.id === props.modelValue.sshConnectionId),
)

const driverUrlPreview = computed(() => {
  const via = selectedSsh.value ? ` (via SSH ${selectedSsh.value.name})` : ''
  return (
    buildDbConnectionUrl({
      engine: props.modelValue.engine as DbUrlEngine,
      host: props.modelValue.host,
      port: props.modelValue.port || engineMeta.value.defaultPort,
      database: props.modelValue.database,
      username: props.modelValue.username,
      ssl: !!(props.modelValue.ssl || props.modelValue.sslOptions?.enabled),
      extraOptions: props.modelValue.extraOptions,
    }) + via
  )
})

const presetKeys = computed(
  () => ADVANCED_OPTION_KEYS[props.modelValue.engine as DbUrlEngine] || ADVANCED_OPTION_KEYS.mysql,
)

function syncExtraRowsFromForm() {
  const entries = Object.entries(props.modelValue.extraOptions || {})
  extraRows.value = entries.length
    ? entries.map(([key, value]) => ({ key, value }))
    : [{ key: '', value: '' }]
}

function commitExtraRows() {
  const next: Record<string, string> = {}
  for (const row of extraRows.value) {
    const k = row.key.trim()
    if (!k) continue
    next[k] = row.value
  }
  patch('extraOptions', next)
}

function addExtraRow() {
  extraRows.value = [...extraRows.value, { key: '', value: '' }]
}

function removeExtraRow(idx: number) {
  const next = extraRows.value.filter((_, i) => i !== idx)
  extraRows.value = next.length ? next : [{ key: '', value: '' }]
  commitExtraRows()
}

function applyPresetKey(key: string) {
  if (!key) return
  if (extraRows.value.some((r) => r.key === key)) return
  extraRows.value = [...extraRows.value.filter((r) => r.key.trim() || r.value.trim()), { key, value: '' }]
  if (!extraRows.value.length) extraRows.value = [{ key, value: '' }]
  commitExtraRows()
}

function applyUrlImport() {
  urlImportHint.value = ''
  const parsed = parseDbConnectionUrl(urlImport.value, props.modelValue.engine as DbUrlEngine)
  if (parsed.warnings.includes('empty') || parsed.warnings.includes('invalid_url')) {
    urlImportHint.value = t('database.connection.urlImportInvalid')
    return
  }
  const next: ConnectionFormModel = { ...props.modelValue }
  if (parsed.engine) next.engine = parsed.engine
  if (parsed.host) next.host = parsed.host
  if (parsed.port) next.port = parsed.port
  if (parsed.username) next.username = parsed.username
  if (parsed.password != null && parsed.password !== '') next.password = parsed.password
  if (parsed.database != null) next.database = parsed.database
  if (parsed.oracleConnectString) next.database = parsed.oracleConnectString
  if (parsed.ssl != null) {
    next.ssl = parsed.ssl
    next.sslOptions = { ...(next.sslOptions || {}), enabled: parsed.ssl }
  }
  const merged = { ...(next.extraOptions || {}), ...parsed.extraOptions }
  // connectionString already in database for oracle
  if (merged.connectionString && next.engine === 'oracle') {
    next.database = merged.connectionString
  }
  next.extraOptions = merged
  emit('update:modelValue', next)
  syncExtraRowsFromForm()
  const unmapped = parsed.warnings.filter((w) => w.startsWith('unmapped:'))
  urlImportHint.value = unmapped.length
    ? t('database.connection.urlImportPartial', { keys: unmapped.map((w) => w.slice(9)).join(', ') })
    : t('database.connection.urlImportOk')
}

watch(
  () => props.modelValue.name + props.modelValue.engine,
  () => {
    formTab.value = 'main'
    showPassword.value = false
    urlImportHint.value = ''
  },
)

watch(
  () => props.modelValue.extraOptions,
  () => {
    if (formTab.value === 'advanced') syncExtraRowsFromForm()
  },
  { deep: true },
)

watch(formTab, (tab) => {
  if (tab === 'advanced') syncExtraRowsFromForm()
})

onMounted(() => {
  formTab.value = 'main'
  syncExtraRowsFromForm()
})
</script>

<template>
  <div class="ui-modal-overlay" @click.self="emit('close')">
    <div class="ui-modal-card dbeaver-dialog" role="dialog" aria-labelledby="db-conn-dialog-title">
      <header class="dbeaver-dialog-head">
        <h3 id="db-conn-dialog-title">
          {{ editing ? t('database.connection.editTitle') : t('database.connection.createTitle') }}
        </h3>
        <button type="button" class="ui-modal-close" :aria-label="t('database.connection.close')" @click="emit('close')">
          <AppIcon name="close" size="sm" />
        </button>
      </header>

      <form class="dbeaver-dialog-body" @submit.prevent="emit('save')">
        <div class="dbeaver-driver-bar">
          <div class="dbeaver-driver-badge" :class="engineMeta.badgeClass" :title="engineMeta.label">
            <AppIcon name="server" size="2xl" />
            <span>{{ engineMeta.label }}</span>
          </div>
          <div class="dbeaver-driver-fields">
            <label class="dbeaver-name-field">
              <span>{{ t('database.connection.engine') }}</span>
              <select
                class="ui-input"
                :value="form.engine"
                :disabled="editing"
                @change="onEngineChange(($event.target as HTMLSelectElement).value as DbEngine)"
              >
                <option value="mysql">MySQL</option>
                <option value="postgres">PostgreSQL</option>
                <option value="oracle">Oracle</option>
              </select>
            </label>
            <label class="dbeaver-name-field">
              <span>{{ t('database.connection.name') }}</span>
              <input
                :value="form.name"
                class="ui-input"
                :placeholder="t('database.connection.namePlaceholder')"
                autofocus
                @input="patch('name', ($event.target as HTMLInputElement).value)"
              />
            </label>
          </div>
        </div>

        <div class="dbeaver-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            class="dbeaver-tab"
            :class="{ active: formTab === 'main' }"
            :aria-selected="formTab === 'main'"
            @click="formTab = 'main'"
          >
            {{ t('database.connection.tabMain') }}
          </button>
          <button
            type="button"
            role="tab"
            class="dbeaver-tab"
            :class="{ active: formTab === 'ssh' }"
            :aria-selected="formTab === 'ssh'"
            @click="formTab = 'ssh'"
          >
            {{ t('database.connection.tabSsh') }}
          </button>
          <button
            type="button"
            role="tab"
            class="dbeaver-tab"
            :class="{ active: formTab === 'ssl' }"
            :aria-selected="formTab === 'ssl'"
            @click="formTab = 'ssl'"
          >
            {{ t('database.connection.tabSsl') }}
          </button>
          <button
            type="button"
            role="tab"
            class="dbeaver-tab"
            :class="{ active: formTab === 'advanced' }"
            :aria-selected="formTab === 'advanced'"
            @click="formTab = 'advanced'"
          >
            {{ t('database.connection.tabAdvanced') }}
          </button>
        </div>

        <div class="dbeaver-tab-panel">
          <div v-show="formTab === 'main'" class="dbeaver-sections">
            <section class="dbeaver-section">
              <h4 class="dbeaver-section-title">{{ t('database.connection.server') }}</h4>
              <div class="dbeaver-grid">
                <label class="dbeaver-field host">
                  <span>{{ t('database.connection.host') }} <em v-if="form.sshConnectionId">{{ t('database.connection.hostSshHint') }}</em></span>
                  <input
                    :value="form.host"
                    class="ui-input"
                    :placeholder="form.sshConnectionId ? t('database.connection.hostPlaceholderTunnel') : 'localhost'"
                    @input="patch('host', ($event.target as HTMLInputElement).value)"
                  />
                </label>
                <label class="dbeaver-field port">
                  <span>{{ t('database.connection.port') }}</span>
                  <input
                    :value="form.port"
                    type="number"
                    class="ui-input"
                    min="1"
                    max="65535"
                    @input="patch('port', Number(($event.target as HTMLInputElement).value) || engineMeta.defaultPort)"
                  />
                </label>
                <label class="dbeaver-field full">
                  <span>
                    {{
                      form.engine === 'oracle'
                        ? t('database.connection.serviceName')
                        : t('database.connection.database')
                    }}
                    <em>{{
                      form.engine === 'postgres'
                        ? t('database.connection.databaseOptionalPg')
                        : form.engine === 'oracle'
                          ? t('database.connection.serviceNameOptional')
                          : t('database.connection.databaseOptional')
                    }}</em>
                  </span>
                  <input
                    :value="form.database"
                    class="ui-input"
                    :placeholder="
                      form.engine === 'postgres'
                        ? 'postgres'
                        : form.engine === 'oracle'
                          ? t('database.connection.serviceNamePlaceholder')
                          : t('database.connection.databasePlaceholder')
                    "
                    @input="patch('database', ($event.target as HTMLInputElement).value)"
                  />
                </label>
                <label class="dbeaver-field full">
                  <span>{{ t('database.connection.group') }} <em>{{ t('database.connection.groupOptional') }}</em></span>
                  <input
                    :value="form.group"
                    class="ui-input"
                    list="db-group-list"
                    :placeholder="t('database.connection.groupPlaceholder')"
                    @input="patch('group', ($event.target as HTMLInputElement).value)"
                  />
                  <datalist id="db-group-list">
                    <option v-for="g in groups" :key="g" :value="g" />
                  </datalist>
                </label>
              </div>
            </section>

            <section class="dbeaver-section">
              <h4 class="dbeaver-section-title">{{ t('database.connection.auth') }}</h4>
              <div class="dbeaver-grid">
                <label class="dbeaver-field full">
                  <span>{{ t('database.connection.username') }}</span>
                  <input
                    :value="form.username"
                    class="ui-input"
                    :placeholder="engineMeta.defaultUser"
                    autocomplete="username"
                    @input="patch('username', ($event.target as HTMLInputElement).value)"
                  />
                </label>
                <label class="dbeaver-field full">
                  <span>{{ t('database.connection.password') }}</span>
                  <div class="dbeaver-pwd">
                    <input
                      :value="form.password"
                      class="ui-input"
                      :type="showPassword ? 'text' : 'password'"
                      autocomplete="current-password"
                      @input="patch('password', ($event.target as HTMLInputElement).value)"
                    />
                    <button type="button" class="dbeaver-pwd-toggle" @click="showPassword = !showPassword">
                      {{ showPassword ? t('database.connection.hide') : t('database.connection.show') }}
                    </button>
                  </div>
                </label>
              </div>
            </section>

            <div class="dbeaver-url-box" :title="t('database.connection.urlPreview')">
              <span class="dbeaver-url-label">URL</span>
              <code class="dbeaver-url">{{ driverUrlPreview }}</code>
            </div>
          </div>

          <div v-show="formTab === 'ssh'" class="dbeaver-sections">
            <section class="dbeaver-section">
              <h4 class="dbeaver-section-title">{{ t('database.connection.sshTunnel') }}</h4>
              <p class="dbeaver-hint">
                {{ t('database.connection.sshHint') }}
              </p>
              <label class="dbeaver-field full">
                <span>{{ t('database.connection.sshConnection') }}</span>
                <select
                  class="ui-input"
                  :value="form.sshConnectionId"
                  @change="patch('sshConnectionId', ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">{{ t('database.connection.noTunnel') }}</option>
                  <option v-for="s in sshConnections" :key="s.id" :value="s.id">
                    {{ s.name }} · {{ s.username }}@{{ s.host }}:{{ s.port || 22 }}
                  </option>
                </select>
              </label>
              <p v-if="!sshConnections.length" class="dbeaver-hint warn">
                {{ t('database.connection.noSsh') }}
              </p>
              <p v-else-if="selectedSsh" class="dbeaver-hint ok">
                {{ t('database.connection.tunnelForward', { name: selectedSsh.name, host: form.host || '…', port: form.port || engineMeta.defaultPort }) }}
              </p>
            </section>
          </div>

          <div v-show="formTab === 'ssl'" class="dbeaver-sections">
            <section class="dbeaver-section">
              <h4 class="dbeaver-section-title">{{ t('database.connection.tabSsl') }}</h4>
              <label class="dbeaver-check">
                <input
                  :checked="!!(form.sslOptions?.enabled ?? form.ssl)"
                  type="checkbox"
                  @change="patchSsl('enabled', ($event.target as HTMLInputElement).checked)"
                />
                <div>
                  <strong>{{ t('database.connection.useSsl') }}</strong>
                  <p>{{ t('database.connection.useSslHint') }}</p>
                </div>
              </label>
              <template v-if="form.sslOptions?.enabled ?? form.ssl">
                <label class="dbeaver-check" style="margin-top: 12px">
                  <input
                    :checked="form.sslOptions?.rejectUnauthorized !== false"
                    type="checkbox"
                    @change="patchSsl('rejectUnauthorized', ($event.target as HTMLInputElement).checked)"
                  />
                  <div>
                    <strong>{{ t('database.connection.rejectUnauthorized') }}</strong>
                    <p>{{ t('database.connection.rejectUnauthorizedHint') }}</p>
                  </div>
                </label>
                <label class="dbeaver-field full" style="margin-top: 10px">
                  <span>{{ t('database.connection.ca') }}</span>
                  <textarea
                    class="ui-input ssl-ta"
                    rows="3"
                    :value="form.sslOptions?.ca || ''"
                    placeholder="-----BEGIN CERTIFICATE-----"
                    @input="patchSsl('ca', ($event.target as HTMLTextAreaElement).value)"
                  />
                </label>
                <label class="dbeaver-field full">
                  <span>{{ t('database.connection.cert') }}</span>
                  <textarea
                    class="ui-input ssl-ta"
                    rows="2"
                    :value="form.sslOptions?.cert || ''"
                    @input="patchSsl('cert', ($event.target as HTMLTextAreaElement).value)"
                  />
                </label>
                <label class="dbeaver-field full">
                  <span>{{ t('database.connection.key') }}</span>
                  <textarea
                    class="ui-input ssl-ta"
                    rows="2"
                    :value="form.sslOptions?.key || ''"
                    @input="patchSsl('key', ($event.target as HTMLTextAreaElement).value)"
                  />
                </label>
              </template>
            </section>
          </div>

          <div v-show="formTab === 'advanced'" class="dbeaver-sections">
            <section class="dbeaver-section">
              <h4 class="dbeaver-section-title">{{ t('database.connection.urlImportTitle') }}</h4>
              <p class="dbeaver-hint">{{ t('database.connection.urlImportHint') }}</p>
              <label class="dbeaver-field full">
                <textarea
                  v-model="urlImport"
                  class="ui-input ssl-ta"
                  rows="3"
                  :placeholder="t('database.connection.urlImportPlaceholder')"
                />
              </label>
              <div class="dbeaver-adv-actions">
                <button type="button" class="ui-btn ui-btn-sm" @click="applyUrlImport">
                  {{ t('database.connection.urlImportApply') }}
                </button>
              </div>
              <p v-if="urlImportHint" class="dbeaver-hint ok">{{ urlImportHint }}</p>
            </section>

            <section class="dbeaver-section">
              <h4 class="dbeaver-section-title">{{ t('database.connection.extraOptionsTitle') }}</h4>
              <p class="dbeaver-hint">{{ t('database.connection.extraOptionsHint') }}</p>
              <label class="dbeaver-field full">
                <span>{{ t('database.connection.extraOptionsPreset') }}</span>
                <select
                  class="ui-input"
                  value=""
                  @change="
                    applyPresetKey(($event.target as HTMLSelectElement).value);
                    ($event.target as HTMLSelectElement).value = ''
                  "
                >
                  <option value="">{{ t('database.connection.extraOptionsPresetPick') }}</option>
                  <option v-for="p in presetKeys" :key="p.key" :value="p.key">
                    {{ p.key }}{{ p.hint ? ` — ${p.hint}` : '' }}
                  </option>
                </select>
              </label>
              <div class="dbeaver-extra-rows">
                <div v-for="(row, idx) in extraRows" :key="idx" class="dbeaver-extra-row">
                  <input
                    v-model="row.key"
                    class="ui-input"
                    :placeholder="t('database.connection.extraKey')"
                    @change="commitExtraRows"
                  />
                  <input
                    v-model="row.value"
                    class="ui-input"
                    :placeholder="t('database.connection.extraValue')"
                    @change="commitExtraRows"
                  />
                  <button type="button" class="ui-btn ui-btn-sm" @click="removeExtraRow(idx)">
                    {{ t('common.delete') }}
                  </button>
                </div>
              </div>
              <button type="button" class="ui-btn ui-btn-sm" style="margin-top: 8px" @click="addExtraRow">
                {{ t('database.connection.extraAddRow') }}
              </button>
            </section>

            <div class="dbeaver-url-box" :title="t('database.connection.urlPreview')">
              <span class="dbeaver-url-label">URL</span>
              <code class="dbeaver-url">{{ driverUrlPreview }}</code>
            </div>
          </div>
        </div>

        <p v-if="testHint" class="dbeaver-test-hint" :class="{ ok: testHint.startsWith(t('database.connection.testSuccessPrefix')) }">
          {{ testHint }}
        </p>

        <footer class="dbeaver-dialog-foot">
          <button type="button" class="ui-btn" :disabled="testing" @click="emit('test')">
            {{ testing ? t('database.connection.testing') : t('database.connection.test') }}
          </button>
          <div class="dbeaver-foot-spacer"></div>
          <button type="button" class="ui-btn" @click="emit('close')">{{ t('database.connection.cancel') }}</button>
          <button type="submit" class="ui-btn ui-btn-primary" :disabled="saving">
            {{ saving ? t('database.connection.saving') : t('database.connection.ok') }}
          </button>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.dbeaver-dialog {
  width: min(580px, calc(100vw - 32px));
  max-height: calc(
    100vh - 48px - env(titlebar-area-height, var(--titlebar-height, 36px))
  );
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: hidden;
  -webkit-app-region: no-drag;
}

.dbeaver-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary);
  flex-shrink: 0;
}

.dbeaver-dialog-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.dbeaver-dialog-body {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.dbeaver-driver-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary);
  flex-shrink: 0;
}

.dbeaver-driver-badge {
  width: 72px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 6px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid color-mix(in srgb, #ed8936 30%, var(--border-color));
  background: linear-gradient(160deg, #f6ad5522, transparent 70%);
  color: #dd6b20;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-align: center;
}

.dbeaver-driver-badge.postgres {
  border-color: color-mix(in srgb, #3182ce 30%, var(--border-color));
  background: linear-gradient(160deg, #63b3ed22, transparent 70%);
  color: #3182ce;
}

.dbeaver-driver-badge.oracle {
  border-color: color-mix(in srgb, #e53e3e 30%, var(--border-color));
  background: linear-gradient(160deg, #fc818122, transparent 70%);
  color: #c53030;
}

.dbeaver-driver-fields {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dbeaver-name-field {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-secondary);
}

.dbeaver-tabs {
  display: flex;
  gap: 0;
  padding: 0 12px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  flex-shrink: 0;
}

.dbeaver-tab {
  position: relative;
  height: 34px;
  padding: 0 14px;
  border: none;
  background: none;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.dbeaver-tab:hover {
  color: var(--text-primary);
}

.dbeaver-tab.active {
  color: var(--accent);
}

.dbeaver-tab.active::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 0;
  height: 2px;
  border-radius: 2px 2px 0 0;
  background: var(--accent);
}

.dbeaver-tab-panel {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px 8px;
}

.dbeaver-sections {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dbeaver-section {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md, 8px);
  background: var(--bg-primary);
  padding: 12px 12px 14px;
}

.dbeaver-section-title {
  margin: 0 0 10px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-secondary);
}

.dbeaver-grid {
  display: grid;
  grid-template-columns: 1fr 100px;
  gap: 10px 12px;
}

.dbeaver-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-size: 12px;
  color: var(--text-secondary);
  min-width: 0;
}

.dbeaver-field.full {
  grid-column: 1 / -1;
}

.dbeaver-field.host {
  grid-column: 1;
}

.dbeaver-field.port {
  grid-column: 2;
}

.dbeaver-field em {
  font-style: normal;
  opacity: 0.65;
  margin-left: 4px;
}

.dbeaver-pwd {
  display: flex;
}

.dbeaver-pwd .ui-input {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
  flex: 1;
  min-width: 0;
}

.dbeaver-pwd-toggle {
  width: 56px;
  flex-shrink: 0;
  border: 1px solid var(--border-color);
  border-left: none;
  border-radius: 0 8px 8px 0;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-size: 12px;
  cursor: pointer;
}

.dbeaver-pwd-toggle:hover {
  color: var(--text-primary);
}

.dbeaver-url-box {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px dashed var(--border-color);
  background: var(--bg-primary);
}

.dbeaver-url-label {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--text-secondary);
  padding-top: 1px;
}

.dbeaver-url {
  flex: 1;
  min-width: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-primary);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  word-break: break-all;
  opacity: 0.9;
}

.dbeaver-check {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  color: var(--text-primary);
}

.dbeaver-check input {
  margin-top: 3px;
  flex-shrink: 0;
}

.dbeaver-check strong {
  display: block;
  font-size: 13px;
  font-weight: 600;
}

.dbeaver-check p,
.dbeaver-hint {
  margin: 4px 0 10px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.45;
}

.dbeaver-hint.warn {
  color: var(--warning, #d69e2e);
}

.dbeaver-hint.ok {
  color: var(--success);
}

.ssl-ta {
  font-family: var(--font-mono, Consolas, monospace);
  font-size: 11px;
  resize: vertical;
  min-height: 48px;
}

.dbeaver-adv-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.dbeaver-extra-rows {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.dbeaver-extra-row {
  display: grid;
  grid-template-columns: 1fr 1fr auto;
  gap: 8px;
  align-items: center;
}

.dbeaver-test-hint {
  margin: 0;
  padding: 0 16px 8px;
  font-size: 12px;
  color: var(--danger);
  flex-shrink: 0;
}

.dbeaver-test-hint.ok {
  color: var(--success);
}

.dbeaver-dialog-foot {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--border-color);
  background: var(--bg-primary);
  flex-shrink: 0;
}

.dbeaver-foot-spacer {
  flex: 1;
}
</style>
