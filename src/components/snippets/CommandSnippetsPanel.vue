<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appConfirm, appPrompt } from '@/composables/app/useAppDialog'

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

const snippets = ref<CommandSnippet[]>([])
const loading = ref(false)
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

async function loadSnippets() {
  loading.value = true
  try {
    snippets.value = await window.LiteConnect.getCommandSnippets()
  } finally {
    loading.value = false
  }
}

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
  snippets.value = await window.LiteConnect.setCommandSnippets(next)
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
  snippets.value = await window.LiteConnect.setCommandSnippets(next)
  if (editingId.value === id) resetForm()
  menuOpenId.value = null
  ElMessage.success(t('snippets.deleted'))
}

async function togglePin(item: CommandSnippet) {
  const next = snippets.value.map((s) =>
    s.id === item.id ? { ...s, pinned: !s.pinned } : s,
  )
  snippets.value = await window.LiteConnect.setCommandSnippets(next)
  menuOpenId.value = null
}

async function bumpUse(item: CommandSnippet) {
  const next = snippets.value.map((s) =>
    s.id === item.id
      ? {
          ...s,
          useCount: (s.useCount || 0) + 1,
          lastUsedAt: Date.now(),
        }
      : s,
  )
  try {
    snippets.value = await window.LiteConnect.setCommandSnippets(next)
  } catch {
    // non-fatal
  }
}

function contextForSession(sessionId: string | null): SnippetContext | null {
  if (!sessionId) return props.snippetContext || null
  const s = props.sessions?.find((x) => x.id === sessionId)
  if (s && (s.host || s.user)) {
    return {
      host: s.host,
      user: s.user,
      port: s.port,
      name: s.name,
    }
  }
  return props.snippetContext || null
}

/** Prompt for custom vars; built-ins filled from context + dynamic */
async function resolveForContext(command: string, ctx: SnippetContext | null): Promise<string | null> {
  const dynamic = await resolveDynamicBuiltins()
  const mergedCtx: SnippetContext = { ...(ctx || {}), ...dynamic }
  const pending = pendingSnippetVars(command, mergedCtx)
  const extra: Record<string, string> = { ...dynamic }
  for (const name of pending) {
    try {
      const value = await appPrompt({
        title: t('snippets.fillVarTitle'),
        message: t('snippets.fillVarMessage', { var: name }),
        inputPlaceholder: name,
        required: false,
      })
      extra[name] = value
    } catch {
      return null
    }
  }
  return resolveSnippetCommand(command, mergedCtx, extra)
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
    await bumpUse(item)
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
  for (const name of pendingCustom) {
    try {
      const value = await appPrompt({
        title: t('snippets.fillVarTitle'),
        message: t('snippets.fillVarMessageMulti', { var: name }),
        inputPlaceholder: name,
        required: false,
      })
      extra[name] = value
    } catch {
      return
    }
  }
  for (const sid of targets) {
    const resolved = resolveSnippetCommand(
      item.command,
      { ...contextForSession(sid), ...dynamic },
      extra,
    )
    window.LiteConnect.sshWrite(sid, formatSnippetPayloadForWrite(resolved, mode))
  }
  await bumpUse(item)
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
  for (const name of pendingCustom) {
    try {
      const value = await appPrompt({
        title: t('snippets.fillVarTitle'),
        message: t('snippets.fillVarMessage', { var: name }),
        inputPlaceholder: name,
        required: false,
      })
      extra[name] = value
    } catch {
      return
    }
  }
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

function toggleMultiSession(id: string) {
  const set = new Set(multiSessionIds.value)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  multiSessionIds.value = Array.from(set)
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
  snippets.value = await window.LiteConnect.setCommandSnippets(reordered)
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
        <button type="button" class="ui-btn ui-btn-xs" :title="t('snippets.export')" @click="exportSnippets">{{ t('snippets.export') }}</button>
        <button type="button" class="ui-btn ui-btn-xs" :title="t('snippets.importAppend')" @click="importSnippets('append')">{{ t('snippets.import') }}</button>
        <button type="button" class="ui-btn ui-btn-xs" :title="t('snippets.importReplace')" @click="importSnippets('replace')">{{ t('snippets.replace') }}</button>
        <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close snippets-close" :aria-label="t('snippets.close')" @click="emit('close')">
          <AppIcon name="close" size="sm" />
        </button>
      </div>
    </div>

    <div class="snippets-hint">
      {{ t('snippets.builtins') }}
      <code v-pre>{host}</code>
      <code v-pre>{user}</code>
      <code v-pre>{port}</code>
      <code v-pre>{name}</code>
      <code v-pre>{date}</code>
      <code v-pre>{time}</code>
      <code v-pre>{clipboard}</code>
      {{ t('snippets.hint') }}
      <span v-if="contextPreview" class="ctx-preview">{{ t('snippets.currentCtx', { ctx: contextPreview }) }}</span>
    </div>

    <div v-if="sessions && sessions.length > 0" class="multi-session">
      <div class="multi-label">{{ t('snippets.sendTo') }}</div>
      <div class="multi-list">
        <label v-for="s in sessions" :key="s.id" class="multi-item">
          <input
            type="checkbox"
            :checked="multiSessionIds.includes(s.id)"
            @change="toggleMultiSession(s.id)"
          />
          <span>{{ s.label }}</span>
        </label>
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
        <select v-model="formSendMode" class="ui-input ui-input-sm form-select">
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
                class="pin-btn"
                :class="{ active: item.pinned }"
                :title="item.pinned ? t('snippets.unpin') : t('snippets.pin')"
                @click.stop="togglePin(item)"
              >
                <AppIcon :name="item.pinned ? 'star-fill' : 'star'" size="xs" />
              </button>
              <span class="snippet-name">{{ item.name }}</span>
              <span v-if="item.sendMode === 'fill'" class="mode-tag">{{ t('snippets.fill') }}</span>
              <span v-if="item.hotkey" class="hotkey-tag">{{ item.hotkey }}</span>
            </div>
            <code class="snippet-cmd">{{ item.command }}</code>
            <div class="snippet-actions">
              <button type="button" class="ui-btn ui-btn-xs ui-btn-primary" @click="runSnippet(item)">
                {{ item.sendMode === 'fill' ? t('snippets.fill') : t('snippets.run') }}
              </button>
              <div class="more-wrap" @click.stop>
                <button type="button" class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm" @click="toggleMenu(item.id)" :title="t('snippets.more')">
                  <AppIcon name="more" size="sm" />
                </button>
                <div v-if="menuOpenId === item.id" class="more-menu">
                  <button type="button" class="more-item" @click="sendToBatch(item)">{{ t('snippets.batch') }}</button>
                  <button type="button" class="more-item" @click="copySnippet(item)">{{ t('snippets.copy') }}</button>
                  <button type="button" class="more-item" @click="startEdit(item)">{{ t('snippets.edit') }}</button>
                  <button type="button" class="more-item" @click="togglePin(item)">
                    {{ item.pinned ? t('snippets.unpin') : t('snippets.pin') }}
                  </button>
                  <button type="button" class="more-item danger" @click="removeSnippet(item.id)">{{ t('snippets.delete') }}</button>
                </div>
              </div>
            </div>
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
  height: 100%;
  background: var(--bg-secondary);
  border-left: 1px solid var(--border-color);
  min-width: 280px;
  max-width: 380px;
}

.snippets-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-color);
  gap: 8px;
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
  font-size: 13px;
  color: var(--text-primary);
  flex-shrink: 0;
}

.snippets-close {
  width: 28px;
  height: 28px;
  font-size: 18px;
  line-height: 1;
  margin-left: 2px;
}

.snippets-hint {
  padding: 8px 12px 0;
  font-size: 11px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.snippets-hint code {
  font-size: 10px;
  padding: 0 4px;
  border-radius: 3px;
  background: var(--bg-tertiary);
}

.ctx-preview {
  display: block;
  margin-top: 2px;
  color: var(--accent);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 10px;
}

.multi-session {
  padding: 8px 12px 0;
}

.multi-label {
  font-size: 11px;
  color: var(--text-secondary);
  margin-bottom: 4px;
}

.multi-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 100px;
  overflow-y: auto;
}

.multi-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
}

.search-row {
  padding: 8px 12px 0;
}

.group-filter {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 8px 12px 0;
}

.snippet-form {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  border-bottom: 1px solid var(--border-color);
}

.form-row-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.form-label {
  font-size: 11px;
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
  font-family: var(--font-mono, ui-monospace, Consolas, monospace);
  font-size: 10px;
  border-style: dashed;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.snippets-empty {
  padding: 28px 20px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
}

.snippets-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.snippets-empty-desc {
  font-size: 11px;
  line-height: 1.45;
  max-width: 260px;
  margin: 0 auto;
}

.snippet-list {
  margin: 0;
  padding: 8px;
  overflow-y: auto;
  flex: 1;
}

.group-block {
  margin-bottom: 10px;
}

.group-block-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
  padding: 4px 4px 6px;
}

.group-items {
  list-style: none;
  margin: 0;
  padding: 0;
}

.snippet-item {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 8px;
  background: var(--bg-primary);
  cursor: grab;
}

.snippet-item:active {
  cursor: grabbing;
}

.snippet-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
}

.pin-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0 2px;
  font-size: 12px;
  line-height: 1;
  opacity: 0.55;
}

.pin-btn.active,
.pin-btn:hover {
  color: #e6a23c;
  opacity: 1;
}

.snippet-name {
  font-size: 12px;
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
  font-size: 10px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  flex-shrink: 0;
}

.snippet-cmd {
  display: block;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
  margin-bottom: 6px;
  font-family: ui-monospace, Consolas, monospace;
}

.snippet-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

.more-wrap {
  position: relative;
}

.more-menu {
  position: absolute;
  right: 0;
  top: 100%;
  z-index: 20;
  min-width: 100px;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px;
  display: flex;
  flex-direction: column;
}

.more-item {
  border: none;
  background: transparent;
  text-align: left;
  padding: 6px 10px;
  font-size: 12px;
  color: var(--text-primary);
  border-radius: 4px;
  cursor: pointer;
}

.more-item:hover {
  background: var(--hover-bg, rgba(0, 0, 0, 0.06));
}

.more-item.danger {
  color: var(--danger, #f56c6c);
}
</style>
