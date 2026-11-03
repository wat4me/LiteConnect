<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { appConfirm } from '@/composables/app/useAppDialog'
import type { KnowledgeGroup, KnowledgeGroupResponse } from '@shared/aiKnowledgeGroups'
import { KNOWLEDGE_MAX_BYTES, type KnowledgeTarget } from '@shared/aiKnowledge'
import AppIcon from '../icons/AppIcon.vue'
import VirtualList from '../common/VirtualList.vue'

const props = defineProps<{ initialIds?: string[]; groupId?: string; initialContent?: string }>()
const emit = defineEmits<{ (event: 'close'): void; (event: 'saved', group?: KnowledgeGroup): void }>()
const { t } = useI18n()
const panel = ref<HTMLElement>(), name = ref(''), content = ref(props.initialContent || ''), selected = ref<string[]>([])
const targets = ref<KnowledgeTarget[]>([]), groups = ref<KnowledgeGroup[]>([]), current = ref<KnowledgeGroup>()
const businessSystem = ref(false)
const search = ref(''), memberScroller = ref<HTMLElement>()
const identity = (server: KnowledgeTarget) => JSON.stringify([server.connectionId, server.host.toLowerCase(), server.port, server.username])
const occupied = computed(() => {
  const result = new Map<string, KnowledgeGroup>()
  for (const group of groups.value) if (group.id !== current.value?.id) for (const member of group.members) result.set(identity(member), group)
  return result
})
const memberRows = computed(() => targets.value.map(server => ({ ...server, group: occupied.value.get(identity(server)), searchText: `${server.name} ${server.username}@${server.host}:${server.port}`.toLocaleLowerCase() })))
const filteredMembers = computed(() => {
  const query = search.value.trim().toLocaleLowerCase()
  return query ? memberRows.value.filter(server => server.searchText.includes(query)) : memberRows.value
})
watch(search, () => { if (memberScroller.value) memberScroller.value.scrollTop = 0 })
const pending = ref(true), error = ref(''), ready = ref(false)
let initialSnapshot = ''
const snapshot = () => JSON.stringify([name.value, content.value, selected.value, businessSystem.value])
const oversized = computed(() => new TextEncoder().encode(content.value).length > KNOWLEDGE_MAX_BYTES || (businessSystem.value && content.value.length > 2000))
const invalid = computed(() => !ready.value || !name.value.trim() || !selected.value.length || selected.value.length > 100 || oversized.value)
const previousFocus = document.activeElement as HTMLElement | null
let alive = true
function groupFor(server: KnowledgeTarget) {
  return occupied.value.get(identity(server))
}
function report(reason: unknown) {
  const code = String(reason).match(/KNOWLEDGE_([A-Z_]+)/)?.[1]
  error.value = t(code === 'GROUP_MEMBER_EXISTS' ? 'ai.knowledge.group.memberExists' : code === 'CONFLICT' ? 'ai.knowledge.errors.CONFLICT' : 'ai.knowledge.errors.UNAVAILABLE')
}
function selectGroup(group?: KnowledgeGroup) {
  businessSystem.value = false
  search.value = ''
  current.value = group; name.value = group?.name || ''; content.value = group ? '' : props.initialContent || ''
  selected.value = (group?.members.map(member => member.connectionId) || props.initialIds || []).filter(id => targets.value.some(server => server.connectionId === id && !groupFor(server)))
  initialSnapshot = snapshot()
}
async function changeGroup(event: Event) {
  const field = event.target as HTMLSelectElement
  if (snapshot() !== initialSnapshot) {
    try { await appConfirm({ title: t('ai.knowledge.unsaved'), message: t('ai.knowledge.discard'), confirmText: t('ai.knowledge.discardAction'), cancelText: t('common.cancel') }) }
    catch { field.value = current.value?.id || ''; return }
  }
  if (alive) selectGroup(groups.value.find(group => group.id === field.value))
}
onMounted(async () => {
  try {
    const result: KnowledgeGroupResponse = await window.LiteConnect.aiKnowledgeGroups({ action: 'overview' })
    if (!alive) return
    groups.value = result.groups; targets.value = result.targets || []
    current.value = result.groups.find(group => group.id === props.groupId)
    if (props.groupId && !current.value) throw new Error('KNOWLEDGE_CONFLICT')
    selectGroup(current.value)
    ready.value = true
  } catch (reason) { if (alive) report(reason) }
  finally { if (alive) { pending.value = false; await nextTick(); panel.value?.querySelector<HTMLElement>('input')?.focus() } }
})
onBeforeUnmount(() => { alive = false; if (previousFocus?.isConnected) previousFocus.focus() })
async function close() {
  if (pending.value) return
  if (ready.value && snapshot() !== initialSnapshot) {
    try { await appConfirm({ title: t('ai.knowledge.unsaved'), message: t('ai.knowledge.discard'), confirmText: t('ai.knowledge.discardAction'), cancelText: t('common.cancel') }) } catch { return }
  }
  if (alive) emit('close')
}
async function save() {
  if (pending.value || invalid.value) return
  pending.value = true; error.value = ''
  try {
    const result = await window.LiteConnect.aiKnowledgeGroups({ action: current.value ? 'update' : 'create', groupId: current.value?.id, expectedRevision: current.value?.revision || 0,
      name: name.value, connectionIds: [...selected.value], memberTargets: selected.value.map(id => {
        const server = targets.value.find(server => server.connectionId === id)!
        return { connectionId: server.connectionId, name: server.name, host: server.host, port: server.port, username: server.username }
      }), ...(current.value ? {} : { initialContent: content.value, businessSystem: businessSystem.value }) })
    if (alive) emit('saved', result.group)
  } catch (reason) { if (alive) report(reason) }
  finally { if (alive) pending.value = false }
}
async function remove() {
  if (pending.value || !current.value) return
  try {
    await appConfirm({ title: t('ai.knowledge.group.delete'), message: t('ai.knowledge.group.deleteNotice', { name: current.value.name }), danger: true, confirmText: t('common.delete'), cancelText: t('common.cancel') })
    if (!alive) return
    pending.value = true
    await window.LiteConnect.aiKnowledgeGroups({ action: 'delete', groupId: current.value.id, expectedRevision: current.value.revision })
    if (alive) emit('saved')
  } catch (reason) { if (alive && reason !== 'cancel' && reason !== 'close') report(reason) }
  finally { if (alive) pending.value = false }
}
function trapFocus(event: KeyboardEvent) {
  const controls = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled)') || [])].filter(el => el.checkVisibility())
  const first = controls[0], last = controls.at(-1)
  if (event.shiftKey && (document.activeElement === first || !panel.value?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
}
</script>

<template>
  <Teleport to="body">
    <div class="knowledge-group-layer" @click.self="close" @keydown.esc.stop.prevent="close">
      <section ref="panel" class="knowledge-group-dialog" role="dialog" aria-modal="true" :aria-label="t(current ? 'ai.knowledge.group.manage' : 'ai.knowledge.group.create')" @keydown.tab.stop="trapFocus">
        <header><strong>{{ t(current ? 'ai.knowledge.group.manage' : 'ai.knowledge.group.create') }}</strong><button type="button" class="ui-icon-btn" :disabled="pending" :aria-label="t('common.close')" @click="close"><AppIcon name="close" size="sm" /></button></header>
        <div class="knowledge-group-body">
          <p class="knowledge-group-hint">{{ t('ai.knowledge.group.explanation') }}</p>
          <label v-if="groups.length" class="knowledge-group-field">{{ t('ai.knowledge.group.choose') }}<select :value="current?.id || ''" :disabled="pending || !ready" @change="changeGroup"><option value="">{{ t('ai.knowledge.group.create') }}</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }} · {{ group.members.length }}</option></select></label>
          <label class="knowledge-group-field">{{ t('ai.knowledge.group.name') }}<input v-model="name" maxlength="120" :disabled="pending || !ready" :placeholder="t('ai.knowledge.group.namePlaceholder')" /></label>
          <fieldset class="knowledge-group-members" :disabled="pending || !ready"><legend>{{ t('ai.knowledge.group.members', { count: selected.length }) }}</legend>
            <input v-model="search" class="knowledge-group-search" type="text" :aria-label="t('ai.knowledge.group.searchMembers')" :placeholder="t('ai.knowledge.group.searchMembers')" />
            <div ref="memberScroller" class="knowledge-group-member-scroll">
              <VirtualList :items="filteredMembers" :item-key="server => server.connectionId" :estimated-size="48" :scroll-container="memberScroller" :gap="8">
                <template #default="{ item: server }"><label><input v-model="selected" type="checkbox" :value="server.connectionId" :disabled="!!server.group || (selected.length >= 100 && !selected.includes(server.connectionId))" /><span>{{ server.name }}<small>{{ server.username }}@{{ server.host }}:{{ server.port }}<template v-if="server.group"> · {{ t('ai.knowledge.group.alreadyIn', { name: server.group.name }) }}</template></small></span></label></template>
              </VirtualList>
              <p v-if="!filteredMembers.length" class="knowledge-group-hint">{{ t('ai.knowledge.group.noMembersFound') }}</p>
            </div>
          </fieldset>
          <label v-if="!current" class="knowledge-group-business"><input v-model="businessSystem" type="checkbox" :disabled="pending || !ready" />{{ t('ai.knowledge.system.businessGroup') }}</label>
          <p v-if="!current && businessSystem" class="knowledge-group-hint">{{ t('ai.knowledge.system.businessHint') }}</p>
          <label v-if="!current" class="knowledge-group-field">{{ t('ai.knowledge.group.content') }}<textarea v-model="content" :disabled="pending || !ready" :placeholder="t('ai.knowledge.group.contentPlaceholder')" rows="5" /></label>
          <p class="knowledge-group-hint">{{ t('ai.knowledge.group.consent') }}</p>
          <p v-if="oversized" class="knowledge-group-error" role="alert">{{ t('ai.knowledge.tooLarge') }}</p>
          <p v-if="error" class="knowledge-group-error" role="alert">{{ error }}</p>
        </div>
        <footer><button v-if="current" type="button" class="ui-btn ui-btn-sm" :disabled="pending || !ready" @click="remove">{{ t('ai.knowledge.group.delete') }}</button><span /><button type="button" class="ui-btn ui-btn-sm" :disabled="pending" @click="close">{{ t('common.cancel') }}</button><button type="button" class="ui-btn ui-btn-primary ui-btn-sm knowledge-group-save" :disabled="pending || invalid" @click="save">{{ t(current ? 'common.save' : 'ai.knowledge.group.create') }}</button></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.knowledge-group-layer { position: fixed; inset: 0; z-index: 2050; display: grid; place-items: center; padding: 16px; padding-top: calc(16px + env(titlebar-area-height, var(--titlebar-height, 36px))); box-sizing: border-box; background: #0005; -webkit-app-region: no-drag; }
.knowledge-group-dialog { display: flex; flex-direction: column; width: min(620px, 100%); max-height: 100%; min-height: 0; border: 1px solid var(--border-color); border-radius: 12px; background: var(--bg-primary); color: var(--text-primary); box-shadow: 0 12px 48px #0004; font-size: var(--font-body); -webkit-app-region: no-drag; }
header, footer { display: flex; align-items: center; gap: 8px; padding: 12px 16px; flex-shrink: 0; }
header { justify-content: space-between; border-bottom: 1px solid var(--border-color); }
footer { border-top: 1px solid var(--border-color); flex-wrap: wrap; } footer span { flex: 1; }
.knowledge-group-body { overflow: auto; min-height: 0; padding: 0 16px 12px; }
.knowledge-group-hint { color: var(--text-secondary); font-size: var(--font-caption); line-height: 1.6; }
.knowledge-group-field { display: flex; flex-direction: column; gap: 6px; margin: 12px 0; }
.knowledge-group-field input, textarea, select { box-sizing: border-box; width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); font: inherit; }
textarea { resize: vertical; min-height: 90px; }
.knowledge-group-members { min-width: 0; margin: 12px 0; border: 1px solid var(--border-color); border-radius: 6px; }
.knowledge-group-member-scroll { max-height: 220px; overflow: auto; margin-top: 8px; }
.knowledge-group-search { box-sizing: border-box; width: 100%; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; background: var(--bg-secondary); color: var(--text-primary); font: inherit; }
.knowledge-group-members label { display: flex; align-items: center; gap: 8px; cursor: pointer; }
.knowledge-group-members span { min-width: 0; overflow-wrap: anywhere; }
.knowledge-group-members small { display: block; color: var(--text-secondary); }
.knowledge-group-business { display: flex; align-items: center; gap: 6px; font-size: var(--font-caption); }
.knowledge-group-error { color: var(--danger); font-size: var(--font-caption); }
</style>
