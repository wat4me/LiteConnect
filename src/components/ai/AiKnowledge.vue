<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm } from '@/composables/app/useAppDialog'
import { knowledgeAlwaysIncluded, knowledgeMode, KNOWLEDGE_MODES, KNOWLEDGE_MAX_BYTES, KNOWLEDGE_MEMORY_MAX_CHARS, KNOWLEDGE_MEMORY_MAX_ENTRIES, type KnowledgeMode, type KnowledgeMemoryEntry, type KnowledgeDocument, type KnowledgeDocumentInfo, type KnowledgeOverview, type KnowledgeRequest, type KnowledgeResponse } from '@shared/aiKnowledge'
import AiStreamingMarkdown from './AiStreamingMarkdown.vue'
import AppIcon from '../icons/AppIcon.vue'

const props = defineProps<{ sessionId: string; active: boolean; busy: boolean }>()
const { t } = useI18n()
const overview = ref<KnowledgeOverview>({ storagePath: '', targets: [] })
const open = ref(false), pending = ref(false), editing = ref(false)
const connectionId = ref(''), documents = ref<KnowledgeDocumentInfo[]>([])
const document = ref<KnowledgeDocument>(), title = ref(''), content = ref('')
const documentBinding = ref<string>()
const errorMessage = ref('')
const memoryEntries = ref<KnowledgeMemoryEntry[]>([])
const alwaysInclude = ref(false)
const memoryEntryMode = ref(false)
const panel = ref<HTMLElement>(), trigger = ref<HTMLButtonElement>()
let generation = 0
let previousFocus: HTMLElement | null = null
const target = computed(() => overview.value.targets.find(item => item.connectionId === connectionId.value))
const count = computed(() => overview.value.targets.reduce((total, item) => total + item.count, 0))
const triggerLabel = computed(() => count.value ? t('ai.knowledge.documentCount', { count: count.value }) : t('ai.knowledge.title'))
const singleTarget = computed(() => overview.value.targets.length === 1 ? overview.value.targets[0] : undefined)
const enabledCount = computed(() => overview.value.targets.filter(server => server.enabled).length)
const targetMode = computed(() => knowledgeMode(target.value))
function modeHelp(server?: KnowledgeOverview['targets'][number]) {
  return [t('ai.knowledge.modePurpose'), server ? t(`ai.knowledge.modeHint.${knowledgeMode(server)}`) : t('ai.knowledge.noServer'), t('ai.knowledge.modeScope'), props.busy ? t('ai.knowledge.waitUntilIdle') : ''].filter(Boolean).join('\n')
}
const usageHint = computed(() => modeHelp(singleTarget.value))
const targetUsageHint = computed(() => modeHelp(target.value))
const isMemory = computed(() => document.value?.id === 'memory')
const usesMemoryEntries = computed(() => isMemory.value && memoryEntryMode.value)
const sourceDocuments = computed(() => documents.value.filter(doc => doc.id !== 'memory'))
const memoryChars = computed(() => memoryEntries.value.reduce((total, entry) => total + entry.text.trim().length, 0))
const invalidMemory = computed(() => memoryEntries.value.length > KNOWLEDGE_MEMORY_MAX_ENTRIES || memoryChars.value > KNOWLEDGE_MEMORY_MAX_CHARS || memoryEntries.value.some(entry => !entry.text.trim() || entry.text.trim().length > 160 || /[\r\n]/.test(entry.text) || entry.documentIds.length > 3 || entry.documentIds.some(id => !sourceDocuments.value.some(doc => doc.id === id))))
const dirty = computed(() => editing.value && (title.value !== (document.value?.title || '') || alwaysInclude.value !== (document.value ? knowledgeAlwaysIncluded(document.value) : false) || (usesMemoryEntries.value ? JSON.stringify(memoryEntries.value) !== JSON.stringify(document.value?.memoryEntries) : content.value !== (document.value?.content || ''))))
const oversize = computed(() => new TextEncoder().encode(content.value).length > KNOWLEDGE_MAX_BYTES)
const changed = computed(() => document.value && documents.value.find(item => item.id === document.value!.id)?.revision !== document.value.revision)
function report(error: unknown) {
  const code = String(error instanceof Error ? error.message : error).match(/KNOWLEDGE_([A-Z_]+)/)?.[1] || 'UNAVAILABLE'
  const message = t(`ai.knowledge.errors.${['CONFLICT', 'DISABLED', 'READ_ONLY', 'OUT_OF_SCOPE', 'NOT_FOUND', 'LIMIT', 'INVALID_INPUT', 'SOURCE_NOT_FOUND', 'MEMORY_ENTRIES_REQUIRED'].includes(code) ? code : 'UNAVAILABLE'}`)
  if (open.value) errorMessage.value = message
  else ElMessage.error(message)
}
function apply(response: KnowledgeResponse) {
  overview.value = response
  if (response.documents) documents.value = response.documents
  if (response.document) {
    document.value = response.document
    documentBinding.value = response.targets.find(item => item.connectionId === connectionId.value)?.binding
    title.value = response.document.title; content.value = response.document.content
    memoryEntries.value = structuredClone(response.document.memoryEntries || [])
    alwaysInclude.value = knowledgeAlwaysIncluded(response.document)
    memoryEntryMode.value = response.document.memoryEntries !== undefined
  }
}
async function request(input: KnowledgeRequest) {
  const version = generation, sessionId = props.sessionId, server = connectionId.value
  const response = await window.LiteConnect.aiKnowledge(sessionId, { connectionId: connectionId.value || undefined, binding: target.value?.binding, ...input })
  if (version !== generation || sessionId !== props.sessionId || !props.active || (input.action !== 'overview' && server !== connectionId.value)) return
  if (input.action !== 'overview') errorMessage.value = ''
  apply(response)
  return response
}
async function overviewRefresh(showError = false) {
  if (!props.active || pending.value || !window.LiteConnect.aiKnowledge) return
  try { await request({ action: 'overview' }) } catch (error) { if (showError) report(error) }
}
async function mayLeave() {
  if (!dirty.value) return true
  const version = generation
  try { await appConfirm({ title: t('ai.knowledge.unsaved'), message: t('ai.knowledge.discard'), confirmText: t('ai.knowledge.discardAction'), cancelText: t('common.cancel') }); return version === generation } catch { return false }
}
async function selectDocument(id: string) {
  if (pending.value || !await mayLeave()) return
  const version = generation
  pending.value = true
  editing.value = false
  try { await request({ action: 'read', documentId: id }) } catch (error) { report(error) }
  finally { if (version === generation) pending.value = false }
}
async function loadServer(id: string) {
  if (pending.value || !await mayLeave()) return
  const version = generation
  pending.value = true
  connectionId.value = id; document.value = undefined; editing.value = false; documents.value = []
  try {
    const response = await request({ action: 'list' })
    if (version === generation) pending.value = false
    if (response?.documents?.length) await selectDocument(response.documents[0].id)
  } catch (error) { report(error) } finally { if (version === generation) pending.value = false }
}
async function changeServer(event: Event) { const select = event.target as HTMLSelectElement; await loadServer(select.value); select.value = connectionId.value }
async function show(server?: string, id?: string) {
  if (pending.value) return
  previousFocus = globalThis.document.activeElement as HTMLElement | null
  await overviewRefresh(true)
  if (!props.active) return
  open.value = true
  const selected = server || connectionId.value || overview.value.targets[0]?.connectionId
  if (selected) await loadServer(selected)
  if (id && selected === connectionId.value) await selectDocument(id)
  await nextTick(); panel.value?.querySelector<HTMLElement>('button')?.focus()
}
async function close() {
  if (pending.value || !await mayLeave()) return
  open.value = false; editing.value = false
  await nextTick(); (previousFocus?.isConnected ? previousFocus : trigger.value)?.focus()
}
async function setMode(mode: KnowledgeMode, server = target.value) {
  if (!server || pending.value || props.busy) return
  const version = generation, sessionId = props.sessionId, selectedId = document.value?.id
  pending.value = true
  try {
    if (!await mayLeave()) return
    if (mode !== 'off' && knowledgeMode(server) === 'off' && !server.count) await appConfirm({ title: t('ai.knowledge.enableTitle'), message: t('ai.knowledge.enableNotice', { name: server.name }), detail: overview.value.storagePath,
      confirmText: t('ai.knowledge.enable'), cancelText: t('common.cancel') })
    if (version !== generation || props.busy || overview.value.targets.find(item => item.connectionId === server.connectionId)?.binding !== server.binding) return
    const response = await window.LiteConnect.aiKnowledge(sessionId, { action: 'setMode', connectionId: server.connectionId, binding: server.binding, mode })
    if (version !== generation || sessionId !== props.sessionId || !props.active) return
    overview.value = response
    errorMessage.value = ''
    if (open.value && connectionId.value === server.connectionId) {
      editing.value = false; documents.value = response.documents || []; pending.value = false
      const selected = documents.value.find(doc => doc.id === selectedId) || documents.value[0]
      if (selected) await selectDocument(selected.id)
    }
  } catch (error) { if (version === generation && error !== 'cancel' && error !== 'close') report(error) }
  finally { if (version === generation) pending.value = false }
}
async function changeMode(event: Event, server = target.value) {
  const select = event.target as HTMLSelectElement
  await setMode(select.value as KnowledgeMode, server)
  select.value = knowledgeMode(overview.value.targets.find(item => item.connectionId === server?.connectionId))
}
async function create(importFile = false) {
  if (pending.value || !target.value || !await mayLeave()) return
  const version = generation, binding = target.value?.binding
  pending.value = true
  try {
    const file = importFile ? await window.LiteConnect.aiImportKnowledgeFile() : undefined
    if (importFile && !file || version !== generation || binding !== target.value?.binding) return
    document.value = undefined; documentBinding.value = binding; title.value = file?.path.split(/[\\/]/).pop() || ''; content.value = file?.content || ''; alwaysInclude.value = false; editing.value = true
  } catch (error) { report(error) } finally { if (version === generation) pending.value = false }
}
function beginEdit() {
  memoryEntryMode.value = document.value?.memoryEntries !== undefined
  if (isMemory.value) memoryEntries.value = document.value?.memoryEntries?.map(entry => ({ text: entry.text, documentIds: [...entry.documentIds] })) || []
  editing.value = true
}
function organizeMemory() {
  memoryEntries.value = content.value.trim() ? [{ text: content.value.trim(), documentIds: [] }] : []
  memoryEntryMode.value = true
}
async function save() {
  if (pending.value || !title.value.trim() || (usesMemoryEntries.value ? invalidMemory.value : oversize.value)) return
  pending.value = true
  const version = generation
  try {
    const response = await request({ action: 'save', binding: documentBinding.value, documentId: document.value?.id, expectedRevision: document.value?.revision || 0, title: title.value, alwaysInclude: alwaysInclude.value,
      ...(usesMemoryEntries.value ? { memoryEntries: memoryEntries.value.map(entry => ({ text: entry.text, documentIds: [...entry.documentIds] })) } : { content: content.value }) })
    if (response) { editing.value = false; ElMessage.success(t('ai.knowledge.saved')) }
  } catch (error) { report(error) } finally { if (version === generation) pending.value = false }
}
async function remove() {
  const doc = document.value
  if (!doc || pending.value) return
  const version = generation, binding = target.value?.binding
  try {
    await appConfirm({ title: t('ai.knowledge.deleteTitle'), message: t('ai.knowledge.deleteNotice', { title: doc.title }), danger: true, confirmText: t('common.delete'), cancelText: t('common.cancel') })
    if (version !== generation || binding !== target.value?.binding) return
    pending.value = true
    const response = await request({ action: 'delete', binding: documentBinding.value, documentId: doc.id, expectedRevision: doc.revision })
    if (response) { document.value = undefined; editing.value = false; pending.value = false; if (documents.value[0]) await selectDocument(documents.value[0].id) }
  } catch (error) { if (error !== 'cancel' && error !== 'close') report(error) } finally { if (version === generation) pending.value = false }
}
async function restore(revision: number) {
  if (!document.value || pending.value || !await mayLeave()) return
  pending.value = true
  const version = generation
  try { if (await request({ action: 'restore', binding: documentBinding.value, documentId: document.value.id, expectedRevision: document.value.revision, revision })) editing.value = false }
  catch (error) { report(error) } finally { if (version === generation) pending.value = false }
}
async function exportDocument() {
  if (!document.value || pending.value) return
  const version = generation
  pending.value = true
  try { await window.LiteConnect.aiExportKnowledge(props.sessionId, connectionId.value, document.value.id) } catch (error) { report(error) }
  finally { if (version === generation) pending.value = false }
}
async function refresh() {
  if (pending.value || !await mayLeave()) return
  const id = document.value?.id
  const version = generation
  pending.value = true
  editing.value = false
  try {
    const response = await request({ action: 'list' })
    if (!response) return
    pending.value = false
    document.value = undefined
    const selected = documents.value.find(doc => doc.id === id) || documents.value[0]
    if (selected) await selectDocument(selected.id)
  } catch (error) { report(error) } finally { if (version === generation) pending.value = false }
}
function trapFocus(event: KeyboardEvent) {
  const controls = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary') || [])].filter(el => el.checkVisibility())
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && (globalThis.document.activeElement === first || !panel.value?.contains(globalThis.document.activeElement))) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && globalThis.document.activeElement === last) { event.preventDefault(); first?.focus() }
}
watch(() => props.sessionId, () => { generation++; pending.value = false; open.value = false; editing.value = false; document.value = undefined; documents.value = []; connectionId.value = ''; overview.value = { storagePath: '', targets: [] }; void overviewRefresh() }, { immediate: true })
watch(() => props.active, active => { generation++; pending.value = false; open.value = false; if (active) void overviewRefresh() })
watch(() => props.busy, busy => { if (!busy && !pending.value) { void overviewRefresh(); if (open.value) void request({ action: 'list' }).catch(report) } })
onDeactivated(() => { generation++; pending.value = false; open.value = false })
onActivated(() => { void overviewRefresh() })
onBeforeUnmount(() => { generation++ })
defineExpose({ show })
</script>

<template>
  <span class="knowledge-controls">
    <button ref="trigger" type="button" class="knowledge-trigger" :title="triggerLabel" :aria-label="triggerLabel" aria-haspopup="dialog" :aria-expanded="open" @click="show()"><AppIcon name="file-text" size="sm" /><span v-if="count" class="knowledge-count" aria-hidden="true">{{ count > 99 ? '99+' : count }}</span></button>
    <label v-if="singleTarget || !overview.targets.length" class="knowledge-mode-field" :title="usageHint"><span>{{ t('ai.knowledge.usage') }}</span><select class="knowledge-mode-select" :value="knowledgeMode(singleTarget)" :title="usageHint" :aria-label="t('ai.knowledge.modeLabel')" :aria-description="usageHint" :disabled="!singleTarget || !active || pending || busy" @change="changeMode($event, singleTarget)"><option v-for="mode in KNOWLEDGE_MODES" :key="mode" :value="mode">{{ t(`ai.knowledge.mode.${mode}`) }}</option></select></label>
    <button v-else type="button" class="knowledge-usage-summary" :title="t('ai.knowledge.usageManage', { enabled: enabledCount, total: overview.targets.length })" :aria-label="t('ai.knowledge.usageManage', { enabled: enabledCount, total: overview.targets.length })" aria-haspopup="dialog" :aria-expanded="open" :disabled="!active || pending" @click="show()">{{ t('ai.knowledge.usageEnabled', { enabled: enabledCount, total: overview.targets.length }) }}<AppIcon name="chevron-down" size="xs" /></button>
  </span>
  <Teleport to="body">
    <div v-if="open && active" class="knowledge-layer" @click.self="close" @keydown.esc.stop.prevent="close">
      <section ref="panel" class="knowledge-panel" role="dialog" aria-modal="true" :aria-label="t('ai.knowledge.title')" @keydown.tab="trapFocus">
        <header><strong>{{ t('ai.knowledge.title') }}</strong><span class="knowledge-local">{{ t('ai.knowledge.local') }}</span><button type="button" class="ui-icon-btn" :aria-label="t('common.close')" @click="close"><AppIcon name="close" size="sm" /></button></header>
        <div class="knowledge-toolbar">
          <select :value="connectionId" :disabled="pending" :aria-label="t('ai.knowledge.server')" @change="changeServer"><option v-for="server in overview.targets" :key="server.connectionId" :value="server.connectionId">{{ server.name }} · {{ server.username }}@{{ server.host }}:{{ server.port }}</option></select>
          <label class="knowledge-mode-field" :title="targetUsageHint"><span>{{ t('ai.knowledge.usage') }}</span><select class="knowledge-mode-select" :value="targetMode" :title="targetUsageHint" :aria-label="t('ai.knowledge.modeLabel')" :aria-description="targetUsageHint" :disabled="!target || pending || busy" @change="changeMode($event)"><option v-for="mode in KNOWLEDGE_MODES" :key="mode" :value="mode">{{ t(`ai.knowledge.mode.${mode}`) }}</option></select></label>
          <button type="button" class="ui-icon-btn" :disabled="pending" :title="t('ai.knowledge.refresh')" :aria-label="t('ai.knowledge.refresh')" @click="refresh"><AppIcon name="refresh" size="sm" /></button>
        </div>
        <p class="knowledge-notice">{{ t('ai.knowledge.storageNotice') }} <span :title="overview.storagePath">{{ overview.storagePath }}</span></p>
        <p v-if="!overview.targets.length" class="knowledge-notice">{{ t('ai.knowledge.noServer') }}</p>
        <p v-else-if="!target?.enabled" class="knowledge-notice">{{ t('ai.knowledge.disabledHint') }}</p>
        <p v-else-if="targetMode === 'readonly'" class="knowledge-notice">{{ t('ai.knowledge.modeHint.readonly') }}</p>
        <p v-if="errorMessage" class="knowledge-error knowledge-notice" role="alert">{{ errorMessage }}</p>
        <div class="knowledge-body">
          <aside><div class="knowledge-create"><button type="button" class="ui-btn ui-btn-sm" :disabled="!target?.enabled || pending" @click="create()">{{ t('ai.knowledge.new') }}</button><button type="button" class="ui-btn ui-btn-sm" :disabled="!target?.enabled || pending" @click="create(true)">{{ t('ai.knowledge.import') }}</button></div>
            <button v-for="doc in documents" :key="doc.id" type="button" class="knowledge-doc" :class="{ selected: document?.id === doc.id }" :disabled="pending" @click="selectDocument(doc.id)"><span>{{ doc.title }}</span><small>{{ t(knowledgeAlwaysIncluded(doc) ? 'ai.knowledge.summary' : 'ai.knowledge.onDemand') }}</small></button>
          </aside>
          <main>
            <template v-if="document || editing">
              <div class="knowledge-actions"><button type="button" class="ui-btn ui-btn-sm" :disabled="pending || (editing && (!title.trim() || (usesMemoryEntries ? invalidMemory : oversize)))" @click="editing ? save() : beginEdit()">{{ t(editing ? 'common.save' : 'ai.knowledge.edit') }}</button><button type="button" class="ui-btn ui-btn-sm" :disabled="!document || pending" @click="exportDocument">{{ t('ai.knowledge.export') }}</button><button type="button" class="ui-btn ui-btn-sm" :disabled="!document || pending" @click="remove">{{ t('common.delete') }}</button></div>
              <p v-if="document" class="knowledge-meta">{{ t('ai.knowledge.updated', { revision: document.revision, author: t(document.author === 'ai' ? 'ai.knowledge.aiAuthor' : 'ai.knowledge.userAuthor'), time: new Date(document.updatedAt).toLocaleString() }) }}</p>
              <p v-if="changed" class="knowledge-warning">{{ t('ai.knowledge.changed') }}</p>
              <template v-if="editing"><input v-model="title" maxlength="120" :disabled="pending" :aria-label="t('ai.knowledge.documentTitle')" :placeholder="t('ai.knowledge.documentTitle')" />
                <label class="knowledge-include-choice"><input v-model="alwaysInclude" type="checkbox" :disabled="pending" />{{ t('ai.knowledge.alwaysInclude') }}</label><p class="knowledge-meta">{{ t('ai.knowledge.includeHint') }}</p>
                <template v-if="usesMemoryEntries">
                  <p class="knowledge-meta">{{ t('ai.knowledge.memoryHint', { count: memoryChars }) }}</p>
                  <fieldset v-for="(entry, index) in memoryEntries" :key="index" class="memory-edit-entry" :disabled="pending"><legend>{{ t('ai.knowledge.memoryItem', { index: index + 1 }) }}</legend>
                    <textarea v-model="entry.text" class="memory-entry-text" :aria-label="t('ai.knowledge.memoryItem', { index: index + 1 })" rows="2" spellcheck="false"></textarea>
                    <details class="memory-source-picker"><summary>{{ t('ai.knowledge.sources', { count: entry.documentIds.length }) }}</summary><p v-if="!sourceDocuments.length" class="knowledge-meta">{{ t('ai.knowledge.noSources') }}</p><label v-for="source in sourceDocuments" :key="source.id"><input v-model="entry.documentIds" type="checkbox" :value="source.id" />{{ source.title }}</label></details>
                    <p v-if="entry.documentIds.some(id => !sourceDocuments.some(doc => doc.id === id))" class="knowledge-warning">{{ t('ai.knowledge.sourceMissing') }} <button type="button" class="ui-btn ui-btn-xs" @click="entry.documentIds = entry.documentIds.filter(id => sourceDocuments.some(doc => doc.id === id))">{{ t('ai.knowledge.clearMissing') }}</button></p>
                    <button type="button" class="ui-btn ui-btn-xs" @click="memoryEntries.splice(index, 1)">{{ t('ai.knowledge.removeItem') }}</button>
                  </fieldset>
                  <button type="button" class="ui-btn ui-btn-sm memory-add" :disabled="pending || memoryEntries.length >= KNOWLEDGE_MEMORY_MAX_ENTRIES" @click="memoryEntries.push({ text: '', documentIds: [] })">{{ t('ai.knowledge.addItem') }}</button>
                  <p v-if="invalidMemory" class="knowledge-warning" role="alert">{{ t('ai.knowledge.memoryLimit') }}</p>
                </template>
                <template v-else><button v-if="isMemory" type="button" class="ui-btn ui-btn-sm memory-organize" :disabled="pending" @click="organizeMemory">{{ t('ai.knowledge.organizeMemory') }}</button><textarea v-model="content" :disabled="pending" :aria-label="t('ai.knowledge.content')" spellcheck="false"></textarea><p v-if="oversize" class="knowledge-warning" role="alert">{{ t('ai.knowledge.tooLarge') }}</p></template>
              </template>
              <template v-else><h3>{{ document?.title }}</h3>
                <template v-if="document?.memoryEntries?.length"><article v-for="(entry, index) in document.memoryEntries" :key="index" class="memory-preview-entry"><p>{{ entry.text }}</p><div class="memory-source-links"><template v-for="id in entry.documentIds" :key="id"><button v-if="sourceDocuments.some(doc => doc.id === id)" type="button" class="ui-btn ui-btn-xs" :disabled="pending" @click="selectDocument(id)"><AppIcon name="file-text" size="xs" />{{ sourceDocuments.find(doc => doc.id === id)?.title }}</button><span v-else class="knowledge-warning">{{ t('ai.knowledge.sourceMissing') }}</span></template></div></article></template>
                <template v-else-if="document?.content"><p v-if="isMemory" class="knowledge-meta">{{ t('ai.knowledge.legacyMemory') }}</p><AiStreamingMarkdown :content="document.content" :streaming="false" :terminal-actions="false" /></template><p v-else>{{ t('ai.knowledge.emptyDocument') }}</p>
              </template>
              <details v-if="document?.history.length" class="knowledge-history"><summary>{{ t('ai.knowledge.history') }}</summary><article v-for="version in [...document.history].reverse()" :key="version.revision"><div><span>{{ t('ai.knowledge.updated', { revision: version.revision, author: t(version.author === 'ai' ? 'ai.knowledge.aiAuthor' : 'ai.knowledge.userAuthor'), time: new Date(version.updatedAt).toLocaleString() }) }}</span><button type="button" class="ui-btn ui-btn-xs" :disabled="pending" @click="restore(version.revision)">{{ t('ai.knowledge.restore') }}</button></div><pre>{{ version.content }}</pre></article></details>
            </template><p v-else class="knowledge-notice">{{ t('ai.knowledge.empty') }}</p>
          </main>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.knowledge-controls { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 5px; min-width: 0; }
.knowledge-mode-field, .knowledge-usage-summary { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 5px; min-width: 0; height: var(--ai-composer-tool-size, 26px); padding: 0 3px; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--text-secondary); font: inherit; font-size: var(--font-caption); white-space: nowrap; }
.knowledge-usage-summary { cursor: pointer; }
.knowledge-usage-summary:hover:not(:disabled) { background: var(--hover-bg); color: var(--text-primary); }
.knowledge-mode-select:focus-visible, .knowledge-usage-summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.knowledge-mode-select:disabled, .knowledge-usage-summary:disabled { opacity: .5; cursor: not-allowed; }
.knowledge-mode-field .knowledge-mode-select { flex: 0 0 auto; width: auto; min-width: 0; max-width: 120px; height: 100%; padding: 0 3px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); font: inherit; cursor: pointer; }
.knowledge-toolbar .knowledge-mode-field { height: var(--control-h-sm); }
.knowledge-trigger { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; gap: 4px; min-width: var(--ai-composer-tool-size, 26px); height: var(--ai-composer-tool-size, 26px); box-sizing: border-box; padding: 0 5px; border: 1px solid var(--border-color); border-radius: var(--radius-sm); background: var(--bg-primary); color: var(--text-secondary); font: inherit; font-size: var(--font-caption); line-height: 1; white-space: nowrap; cursor: pointer; }
.knowledge-count { flex-shrink: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
.knowledge-trigger:hover { color: var(--accent); border-color: var(--accent); }
.knowledge-trigger:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
/* Electron titlebar drag regions intercept native clicks even above higher-z-index overlays. */
.knowledge-layer { position: fixed; inset: 0; z-index: 2000; display: grid; place-items: center; padding: 16px; padding-top: calc(16px + env(titlebar-area-height, var(--titlebar-height, 36px))); box-sizing: border-box; background: #0005; -webkit-app-region: no-drag; }
.knowledge-panel { display: flex; flex-direction: column; width: min(1000px, 100%); height: min(760px, 100%); max-height: 100%; min-width: 0; min-height: 0; box-sizing: border-box; overflow: hidden; background: var(--bg-primary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 12px; box-shadow: 0 12px 48px #0004; -webkit-app-region: no-drag; }
header { display: flex; align-items: center; gap: 10px; padding: 14px; border-bottom: 1px solid var(--border-color); }
header button { margin-left: auto; -webkit-app-region: no-drag; }
.knowledge-local, .knowledge-meta, .knowledge-notice, .knowledge-doc small { color: var(--text-secondary); font-size: var(--font-caption); }
.knowledge-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 14px 0; }
select { flex: 1 1 180px; width: 0; min-width: 0; }
select, input, textarea { background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); border-radius: 6px; padding: 8px; font: inherit; }
.knowledge-notice { margin: 8px 14px; line-height: 1.5; overflow-wrap: anywhere; }
.knowledge-notice > span { display: block; }
.knowledge-body { display: grid; grid-template-columns: 210px minmax(0, 1fr); flex: 1; min-height: 0; }
aside, main { min-width: 0; overflow: auto; padding: 12px; }
aside { border-right: 1px solid var(--border-color); }
.knowledge-create, .knowledge-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.knowledge-doc { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; width: 100%; padding: 9px; border: none; border-radius: 6px; background: transparent; color: var(--text-primary); text-align: left; overflow-wrap: anywhere; cursor: pointer; }
.knowledge-doc.selected { background: var(--accent-bg); color: var(--accent); }
main { display: flex; flex-direction: column; gap: 10px; }
main h3, .knowledge-meta { margin: 0; overflow-wrap: anywhere; }
input, textarea { width: 100%; box-sizing: border-box; }
textarea { min-height: 240px; flex: 1; resize: vertical; font-family: var(--font-mono); }
.knowledge-warning { color: var(--warning); font-size: var(--font-caption); }
.knowledge-error { color: var(--danger); }
.knowledge-history { margin-top: 12px; }
.knowledge-history summary { cursor: pointer; }
.knowledge-history article { margin-top: 10px; }
.knowledge-history article > div { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: var(--font-caption); }
.knowledge-history pre { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 180px; overflow: auto; padding: 8px; background: var(--bg-secondary); }
.memory-edit-entry { min-width: 0; margin: 0; padding: 10px; border: 1px solid var(--border-color); border-radius: 8px; }
.memory-edit-entry legend { padding: 0 5px; font-size: var(--font-caption); }
.memory-entry-text { min-height: 60px; flex: none; resize: vertical; }
.memory-source-picker { margin: 8px 0; font-size: var(--font-caption); }
.memory-source-picker summary { cursor: pointer; }
.memory-source-picker label { display: flex; gap: 6px; align-items: center; margin-top: 8px; overflow-wrap: anywhere; }
.memory-source-picker input { width: auto; flex-shrink: 0; }
.memory-preview-entry { padding: 10px; border: 1px solid var(--border-color); border-radius: 8px; }
.memory-preview-entry p { margin: 0 0 8px; white-space: pre-wrap; overflow-wrap: anywhere; }
.memory-source-links { display: flex; flex-wrap: wrap; gap: 6px; }
.memory-source-links button { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; white-space: normal; overflow-wrap: anywhere; text-align: left; }
.memory-add, .memory-organize { align-self: flex-start; }
.knowledge-include-choice { display: flex; align-items: center; gap: 6px; font-size: var(--font-caption); }
.knowledge-include-choice input { width: auto; flex-shrink: 0; }
@media (max-width: 600px) { .knowledge-layer { padding: 8px; padding-top: calc(8px + env(titlebar-area-height, var(--titlebar-height, 36px))); } .knowledge-body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); } aside { max-height: 145px; border-right: 0; border-bottom: 1px solid var(--border-color); } }
</style>
