<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm } from '@/composables/app/useAppDialog'
import { useCommandSnippets } from '@/composables/snippets/useCommandSnippets'

const { t } = useI18n()
import type { CommandSnippet, SnippetSendMode } from '@/env.d'
import {
  compareSnippets,
  formatSnippetPayloadForWrite,
  pendingSnippetVars,
  resolveDynamicBuiltins,
  resolveSnippetCommand,
  type SnippetContext,
} from '@/utils/snippets/commandSnippets'
import AppIcon from '@/components/icons/AppIcon.vue'
import ToolbarDropdown from '@/components/common/ToolbarDropdown.vue'

const headerMenuItems = computed(() => [
  { id: 'export', label: t('snippets.export') },
  { id: 'append', label: t('snippets.importAppend') },
  { id: 'replace', label: t('snippets.importReplace') },
])
function onHeaderAction(id: string) {
  if (id === 'export') void exportSnippets()
  else if (id === 'append' || id === 'replace') void importSnippets(id)
}

const props = defineProps<{
  sessionId: string | null
  /** Connection context for {host}/{user}/{port}/{name} */
  snippetContext?: SnippetContext | null
  /** Other open sessions for multi-send */
  sessions?: Array<{
    id: string
    label: string
    host?: string
    user?: string
    port?: number
    name?: string
  }>
  /** Prefill when saving from terminal selection */
  draftCommand?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  /** Send resolved command into batch panel */
  (e: 'send-to-batch', command: string): void
  (e: 'clear-draft'): void
}>()

const {
  snippets,
  loading,
  loadSnippets,
  saveSnippets,
  recordUse,
  contextForSession,
  promptSnippetVars,
  resolveForContext,
} = useCommandSnippets({
  sessions: () => props.sessions,
  snippetContext: () => props.snippetContext,
})
const editingId = ref<string | null>(null)
const formOpen = ref(false)
const formName = ref('')
const formCommand = ref('')
const formGroup = ref('')
const formSendMode = ref<SnippetSendMode>('run')
const formHotkey = ref('')
const filterGroup = ref('')
const searchQuery = ref('')
const multiSessionIds = ref<string[]>([])
const menuOpenId = ref<string | null>(null)
const dragId = ref<string | null>(null)

const groups = computed(() => {
  const set = new Set<string>()
  for (const s of snippets.value) {
    if (s.group) set.add(s.group)
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
})

const filteredSnippets = computed(() => {
  let list = snippets.value
  if (filterGroup.value) {
    list = list.filter((s) => (s.group || '') === filterGroup.value)
  }
  const q = searchQuery.value.trim().toLowerCase()
  if (q) {
    list = list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q) ||
        (s.group || '').toLowerCase().includes(q) ||
        (s.hotkey || '').toLowerCase().includes(q),
    )
  }
  return [...list].sort(compareSnippets)
})

/** Grouped view for display headers (pinned block first when mixed) */
const groupedView = computed(() => {
  const pinned = filteredSnippets.value.filter((s) => s.pinned)
  const rest = filteredSnippets.value.filter((s) => !s.pinned)
  const blocks: Array<{ group: string; items: CommandSnippet[] }> = []
  if (pinned.length) {
    blocks.push({ group: t('snippets.pinnedGroup'), items: pinned })
  }
  const map = new Map<string, CommandSnippet[]>()
  for (const s of rest) {
    const g = s.group || t('snippets.ungrouped')
    if (!map.has(g)) map.set(g, [])
    map.get(g)!.push(s)
  }
  for (const [group, items] of map.entries()) {
    blocks.push({ group, items })
  }
  return blocks
})

function resetForm() {
  editingId.value = null
  formName.value = ''
  formCommand.value = ''
  formGroup.value = ''
  formSendMode.value = 'run'
  formHotkey.value = ''
  formOpen.value = false
}

function openCreateForm() {
  editingId.value = null
  formName.value = ''
  formCommand.value = props.draftCommand || ''
  formGroup.value = ''
  formSendMode.value = 'run'
  formHotkey.value = ''
  formOpen.value = true
  if (props.draftCommand) emit('clear-draft')
}

function startEdit(item: CommandSnippet) {
  editingId.value = item.id
  formName.value = item.name
  formCommand.value = item.command
  formGroup.value = item.group || ''
  formSendMode.value = item.sendMode === 'fill' ? 'fill' : 'run'
  formHotkey.value = item.hotkey || ''
  formOpen.value = true
  menuOpenId.value = null
}

async function saveSnippet() {
  if (!formCommand.value.trim()) {
    ElMessage.warning(t('snippets.needCommand'))
    return
  }
  const next = [...snippets.value]
  if (editingId.value) {
    const idx = next.findIndex((s) => s.id === editingId.value)
    if (idx >= 0) {
      next[idx] = {
        ...next[idx],
        name: formName.value.trim() || t('snippets.unnamed'),
        command: formCommand.value,
        group: formGroup.value.trim() || undefined,
        sendMode: formSendMode.value,
        hotkey: formHotkey.value.trim() || undefined,
      }
    }
  } else {
    next.unshift({
      id: '',
      name: formName.value.trim() || t('snippets.unnamed'),
      command: formCommand.value,
      group: formGroup.value.trim() || undefined,
      sendMode: formSendMode.value,
      hotkey: formHotkey.value.trim() || undefined,
      pinned: false,
      sortOrder: 0,
      useCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
  }
  const wasEdit = !!editingId.value
  await saveSnippets(next)
  resetForm()
  ElMessage.success(wasEdit ? t('snippets.updated') : t('snippets.added'))
}

async function removeSnippet(id: string) {
  try {
    await appConfirm({
      title: t('snippets.deleteTitle'),
      message: t('snippets.deleteMessage'),
      confirmText: t('common.delete'),
      danger: true,
      tone: 'danger',
    })
  } catch {
    return
  }
  const next = snippets.value.filter((s) => s.id !== id)
  await saveSnippets(next)
  if (editingId.value === id) resetForm()
  menuOpenId.value = null
  ElMessage.success(t('snippets.deleted'))
}

async function togglePin(item: CommandSnippet) {
  const next = snippets.value.map((s) =>
    s.id === item.id ? { ...s, pinned: !s.pinned } : s,
  )
  await saveSnippets(next)
  menuOpenId.value = null
}

function targetSessionIds(): string[] {
  if (multiSessionIds.value.length > 0) return [...multiSessionIds.value]
  return props.sessionId ? [props.sessionId] : []
}

async function runSnippet(item: CommandSnippet) {
  const targets = targetSessionIds()
  if (targets.length === 0) {
    ElMessage.warning(t('snippets.needTerminalOrSession'))
    return
  }
  const mode = item.sendMode === 'fill' ? 'fill' : 'run'
  const dynamic = await resolveDynamicBuiltins()

  if (targets.length === 1) {
    const resolved = await resolveForContext(item.command, contextForSession(targets[0]))
    if (resolved === null) return
    window.LiteConnect.sshWrite(targets[0], formatSnippetPayloadForWrite(resolved, mode))
    await recordUse(item)
    ElMessage.success(mode === 'fill' ? t('snippets.filled', { name: item.name }) : t('snippets.sent', { name: item.name }))
    return
  }

  const pendingCustom = pendingSnippetVars(item.command, {
    host: 'x',
    user: 'x',
    port: '1',
    name: 'x',
    date: 'x',
    time: 'x',
    clipboard: 'x',
  })
  const extra: Record<string, string> = { ...dynamic }
  if (!await promptSnippetVars(pendingCustom, extra, 'snippets.fillVarMessageMulti')) return
  for (const sid of targets) {
    const resolved = resolveSnippetCommand(
      item.command,
      { ...contextForSession(sid), ...dynamic },
      extra,
    )
    window.LiteConnect.sshWrite(sid, formatSnippetPayloadForWrite(resolved, mode))
  }
  await recordUse(item)
  ElMessage.success(t('snippets.sentToSessions', { count: targets.length, name: item.name }))
}

async function copySnippet(item: CommandSnippet) {
  const resolved = await resolveForContext(item.command, contextForSession(props.sessionId))
  if (resolved === null) return
  await window.LiteConnect.clipboardWriteText(resolved)
  menuOpenId.value = null
  ElMessage.success(t('snippets.copiedResolved'))
}

async function sendToBatch(item: CommandSnippet) {
  const dynamic = await resolveDynamicBuiltins()
  const pendingCustom = pendingSnippetVars(item.command, {
    host: 'x',
    user: 'x',
    port: '1',
    name: 'x',
    date: dynamic.date,
    time: dynamic.time,
    clipboard: dynamic.clipboard,
  })
  const extra: Record<string, string> = {
    date: dynamic.date,
    time: dynamic.time,
    clipboard: dynamic.clipboard,
  }
  if (!await promptSnippetVars(pendingCustom, extra)) return
  let result = item.command
  for (const [k, v] of Object.entries(extra)) {
    const escaped = k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    result = result
      .replace(new RegExp(`\\{\\{\\s*${escaped}\\s*\\}\\}`, 'g'), v)
      .replace(new RegExp(`\\{${escaped}\\}`, 'g'), v)
  }
  menuOpenId.value = null
  emit('send-to-batch', result)
  ElMessage.success(t('snippets.sentToBatch'))
}

const CUSTOM_VAR_TOKEN = '{{var}}'

function insertVar(token: string) {
  formCommand.value = (formCommand.value || '') + token
}

async function exportSnippets() {
  try {
    const ok = await window.LiteConnect.exportCommandSnippets()
    if (ok) ElMessage.success(t('snippets.exportOk'))
  } catch (err: any) {
    ElMessage.error(err?.message || t('snippets.exportFailed'))
  }
}

async function importSnippets(mode: 'append' | 'replace') {
  if (mode === 'replace') {
    try {
      await appConfirm({
        title: t('snippets.replaceImportTitle'),
        message: t('snippets.replaceImportMessage'),
        confirmText: t('snippets.replaceImportConfirm'),
        danger: true,
        tone: 'danger',
      })
    } catch {
      return
    }
  }
  try {
    const result = await window.LiteConnect.importCommandSnippets(mode)
    if (!result) return
    await loadSnippets()
    ElMessage.success(t('snippets.imported', { imported: result.imported, total: result.total }))
  } catch (err: any) {
    ElMessage.error(err?.message || t('snippets.importFailed'))
  }
}

const contextPreview = computed(() => {
  const c = props.snippetContext
  if (!c?.host && !c?.user) return ''
  return `${c.user || '?'}@${c.host || '?'}${c.port != null ? ':' + c.port : ''}`
})

function onDragStart(id: string) {
  dragId.value = id
}

function onDragOver(e: DragEvent) {
  e.preventDefault()
}

async function onDrop(targetId: string) {
  const fromId = dragId.value
  dragId.value = null
  if (!fromId || fromId === targetId) return
  const list = [...snippets.value].sort(compareSnippets)
  const fromIdx = list.findIndex((s) => s.id === fromId)
  const toIdx = list.findIndex((s) => s.id === targetId)
  if (fromIdx < 0 || toIdx < 0) return
  const [moved] = list.splice(fromIdx, 1)
  list.splice(toIdx, 0, moved)
  const reordered = list.map((s, i) => ({ ...s, sortOrder: i }))
  await saveSnippets(reordered)
}

function toggleMenu(id: string) {
  menuOpenId.value = menuOpenId.value === id ? null : id
}

function onDocClick() {
  menuOpenId.value = null
}

watch(
  () => props.draftCommand,
  (cmd) => {
    if (cmd) openCreateForm()
  },
)

onMounted(() => {
  void loadSnippets()
  document.addEventListener('click', onDocClick)
  if (props.draftCommand) openCreateForm()
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <div class="snippets-panel">
    <div class="snippets-header">
      <span class="snippets-title">{{ t('snippets.title') }}</span>
      <div class="header-actions">
        <button type="button" class="ui-btn ui-btn-xs ui-btn-primary" :title="t('snippets.new')" @click="openCreateForm">{{ t('snippets.new') }}</button>
        <ToolbarDropdown :label="t('snippets.more')" :items="headerMenuItems" icon-only teleport align="right" @select="onHeaderAction" />
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close snippets-close" :aria-label="t('snippets.close')" @click="emit('close')">
          <AppIcon name="close" size="sm" />
        </button>
      </div>
    </div>

    <div class="search-row">
      <input v-model="searchQuery" class="ui-input ui-input-sm" :placeholder="t('snippets.searchPlaceholder')" />
    </div>

    <div v-if="groups.length" class="group-filter">
      <button
        type="button"
        class="ui-chip"
        :class="{ active: !filterGroup }"
        @click="filterGroup = ''"
      >
        {{ t('snippets.all') }}
      </button>
      <button
        v-for="g in groups"
        :key="g"
        type="button"
        class="ui-chip"
        :class="{ active: filterGroup === g }"
        @click="filterGroup = g"
      >
        {{ g }}
      </button>
    </div>

    <div v-if="formOpen" class="snippet-form">
      <input v-model="formName" class="ui-input ui-input-sm" :placeholder="t('snippets.nameOptional')" />
      <input v-model="formGroup" class="ui-input ui-input-sm" list="snippet-group-list" :placeholder="t('snippets.groupOptional')" />
      <datalist id="snippet-group-list">
        <option v-for="g in groups" :key="g" :value="g" />
      </datalist>
      <textarea
        v-model="formCommand"
        class="ui-textarea ui-input-sm ui-input-mono"
        rows="3"
        :placeholder="t('snippets.commandPlaceholder')"
      />
      <div class="form-row-inline">
        <label class="form-label">{{ t('snippets.send') }}</label>
        <select v-model="formSendMode" class="ui-select ui-input-sm form-select">
          <option value="run">{{ t('snippets.modeRun') }}</option>
          <option value="fill">{{ t('snippets.modeFill') }}</option>
        </select>
        <input
          v-model="formHotkey"
          class="ui-input ui-input-sm form-hotkey"
          :placeholder="t('snippets.hotkeyPlaceholder')"
        />
      </div>
      <div class="var-chips">
        <button type="button" class="ui-chip" @click="insertVar('{host}')">{host}</button>
        <button type="button" class="ui-chip" @click="insertVar('{user}')">{user}</button>
        <button type="button" class="ui-chip" @click="insertVar('{port}')">{port}</button>
        <button type="button" class="ui-chip" @click="insertVar('{name}')">{name}</button>
        <button type="button" class="ui-chip" @click="insertVar('{date}')">{date}</button>
        <button type="button" class="ui-chip" @click="insertVar('{time}')">{time}</button>
        <button type="button" class="ui-chip" @click="insertVar('{clipboard}')">{clipboard}</button>
        <button type="button" class="ui-chip" @click="insertVar(CUSTOM_VAR_TOKEN)">{{ CUSTOM_VAR_TOKEN }}</button>
      </div>
      <div class="snippets-hint">
        {{ t('snippets.builtins') }} {{ t('snippets.hint') }}
        <span v-if="contextPreview" class="ctx-preview">{{ t('snippets.currentCtx', { ctx: contextPreview }) }}</span>
      </div>
      <div class="form-actions">
        <button type="button" class="ui-btn ui-btn-sm ui-btn-ghost" @click="resetForm">{{ t('snippets.cancel') }}</button>
        <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" @click="saveSnippet">
          {{ editingId ? t('snippets.update') : t('snippets.add') }}
        </button>
      </div>
    </div>

    <div v-if="loading" class="snippets-empty">{{ t('snippets.loading') }}</div>
    <div v-else-if="filteredSnippets.length === 0" class="snippets-empty">
      <div class="snippets-empty-title">{{ t('snippets.emptyTitle') }}</div>
      <div class="snippets-empty-desc">{{ t('snippets.emptyDesc') }}</div>
      <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" style="margin-top: 10px" @click="openCreateForm">{{ t('snippets.newSnippet') }}</button>
    </div>
    <div v-else class="snippet-list">
      <div v-for="block in groupedView" :key="block.group" class="group-block">
        <div class="group-block-title">{{ block.group }} · {{ block.items.length }}</div>
        <ul class="group-items">
          <li
            v-for="item in block.items"
            :key="item.id"
            class="snippet-item"
            draggable="true"
            @dragstart="onDragStart(item.id)"
            @dragover="onDragOver"
            @drop="onDrop(item.id)"
            @dblclick="runSnippet(item)"
          >
            <div class="snippet-meta">
              <button
                type="button"
                class="pin-btn ui-icon-btn ui-icon-btn-sm"
                :class="{ active: item.pinned }"
                :title="item.pinned ? t('snippets.unpin') : t('snippets.pin')"
                @click.stop="togglePin(item)"
              >
                <AppIcon :name="item.pinned ? 'star-fill' : 'star'" size="xs" />
              </button>
              <span class="snippet-name" :title="item.name">{{ item.name }}</span>
              <span v-if="item.sendMode === 'fill'" class="mode-tag">{{ t('snippets.fill') }}</span>
              <span v-if="item.hotkey" class="hotkey-tag">{{ item.hotkey }}</span>
              <div class="snippet-actions">
                <button type="button" class="ui-btn ui-btn-xs" @click.stop="runSnippet(item)">
                  {{ item.sendMode === 'fill' ? t('snippets.fill') : t('snippets.run') }}
                </button>
                <div class="more-wrap" @click.stop>
                  <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" @click="toggleMenu(item.id)" :title="t('snippets.more')">
                    <AppIcon name="more" size="sm" />
                  </button>
                  <div v-if="menuOpenId === item.id" class="ui-menu ui-menu-anchored">
                    <button type="button" class="ui-menu-item" @click="sendToBatch(item)">{{ t('snippets.batch') }}</button>
                    <button type="button" class="ui-menu-item" @click="copySnippet(item)">{{ t('snippets.copy') }}</button>
                    <button type="button" class="ui-menu-item" @click="startEdit(item)">{{ t('snippets.edit') }}</button>
                    <button type="button" class="ui-menu-item" @click="togglePin(item)">
                      {{ item.pinned ? t('snippets.unpin') : t('snippets.pin') }}
                    </button>
                    <button type="button" class="ui-menu-item danger" @click="removeSnippet(item.id)">{{ t('snippets.delete') }}</button>
                  </div>
                </div>
              </div>
            </div>
            <code class="snippet-cmd">{{ item.command }}</code>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.snippets-panel {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 0;
  background: var(--bg-primary);
  overflow: hidden;
}

.snippets-header {
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid color-mix(in srgb, var(--border-color) 65%, transparent);
  background: var(--bg-secondary);
  gap: 8px;
  flex-shrink: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.snippets-title {
  font-weight: 600;
  font-size: var(--font-ui);
  color: var(--text-primary);
  flex-shrink: 0;
}

.snippets-close {
  margin-left: 2px;
}

.snippets-hint {
  font-size: var(--font-ai-detail, 12px);
  color: var(--text-secondary);
  line-height: 1.5;
}

.ctx-preview {
  display: block;
  margin-top: 2px;
  color: var(--accent);
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: var(--font-ai-detail, 12px);
}

.multi-session {
  padding: 10px 12px 0;
}

.multi-label {
  font-size: var(--font-ai-detail, 12px);
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.multi-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 88px;
  overflow-y: auto;
}

.multi-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border-radius: var(--radius-md);
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  background: var(--bg-secondary);
  font-size: var(--font-ai-detail, 12px);
  color: var(--text-primary);
  cursor: pointer;
}

.multi-item.selected {
  background: var(--tab-selected-surface);
  border-color: color-mix(in srgb, var(--text-primary) 24%, var(--border-color));
}

.multi-item input {
  margin: 0;
  accent-color: var(--accent);
}

.search-row {
  padding: 10px 12px 0;
}

.group-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 8px 12px 0;
}

.snippet-form {
  margin: 10px 12px 0;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-lg, 12px);
  background: var(--bg-secondary);
}

.form-row-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.form-label {
  font-size: var(--font-ai-detail, 12px);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.form-select {
  width: auto;
  min-width: 110px;
  flex: 0 0 auto;
}

.form-hotkey {
  flex: 1;
  min-width: 100px;
}

.var-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.var-chips .ui-chip {
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
  font-size: var(--font-caption);
  border-style: dashed;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.snippets-empty {
  padding: 36px 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: var(--font-ai-detail, 12px);
}

.snippets-empty-title {
  font-size: var(--font-ui);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.snippets-empty-desc {
  font-size: var(--font-ai-detail, 12px);
  line-height: 1.5;
  max-width: 260px;
  margin: 0 auto;
}

.snippet-list {
  margin: 0;
  padding: 10px 12px 12px;
  overflow-y: auto;
  flex: 1;
}

.group-block {
  margin-bottom: 12px;
}

.group-block-title {
  font-size: var(--font-ai-detail, 12px);
  font-weight: 600;
  color: var(--text-secondary);
  padding: 2px 4px 6px;
}

.group-items {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.snippet-item {
  border: 1px solid color-mix(in srgb, var(--border-color) 75%, transparent);
  border-radius: var(--radius-lg, 12px);
  padding: 9px 11px;
  background: var(--bg-primary);
  box-shadow: inset 0 1px 0 var(--mica-highlight, transparent);
  cursor: grab;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.snippet-item:hover {
  background: var(--bg-secondary);
  border-color: color-mix(in srgb, var(--text-primary) 16%, var(--border-color));
}

.snippet-item:active {
  cursor: grabbing;
}

.snippet-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

/* Compact to sit inline with the snippet name. */
.pin-btn {
  width: 20px;
  height: 20px;
}

/* Pinned is content state (favorite star), not a toggled panel: keep the star tint, no chip. */
.pin-btn.active {
  color: var(--warning);
  background: transparent;
}

.snippet-name {
  font-size: var(--font-ui-sm);
  font-weight: 600;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mode-tag,
.hotkey-tag {
  font-size: var(--font-caption);
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.snippet-cmd {
  display: block;
  font-size: var(--font-ai-detail, 12px);
  color: var(--text-secondary);
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: var(--font-mono, 'Cascadia Code', 'Fira Code', Consolas, monospace);
}

.snippet-item:hover .snippet-cmd {
  background: var(--bg-tertiary);
}

.snippet-actions {
  display: inline-flex;
  gap: 4px;
  align-items: center;
  flex-shrink: 0;
  margin-left: auto;
}

.more-wrap {
  position: relative;
}

.more-wrap .ui-menu-anchored {
  right: 0;
  top: 100%;
  min-width: 100px;
}
</style>
