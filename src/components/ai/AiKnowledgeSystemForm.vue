<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { SYSTEM_MAX_NODES, SYSTEM_MAX_DEPENDENCIES, type KnowledgeSystem, type KnowledgeSystemMember } from '@shared/aiKnowledgeSystem'
const model = defineModel<KnowledgeSystem>({ required: true })
const props = defineProps<{ members: KnowledgeSystemMember[]; disabled: boolean }>()
const { t } = useI18n()
function addNode() {
  const member = props.members.find(member => member.available)
  model.value.nodes.push({ id: `service-${crypto.randomUUID()}`, connectionId: member?.connectionId || '', binding: member?.binding || '', role: '', note: '', status: 'unconfirmed' })
}
function selectMember(index: number, event: Event) {
  const member = props.members.find(member => member.connectionId === (event.target as HTMLSelectElement).value)
  if (member) { model.value.nodes[index].connectionId = member.connectionId; model.value.nodes[index].binding = member.binding }
}
function removeNode(id: string) { model.value.nodes = model.value.nodes.filter(node => node.id !== id); model.value.dependencies = model.value.dependencies.filter(edge => edge.from !== id && edge.to !== id) }
function addDependency() { model.value.dependencies.push({ from: model.value.nodes[0]?.id || '', to: model.value.nodes[1]?.id || '', label: '', status: 'unconfirmed' }) }
</script>

<template>
  <div class="knowledge-system-form">
    <label>{{ t('ai.knowledge.system.description') }}<textarea v-model="model.description" maxlength="2000" rows="4" :disabled="disabled" :placeholder="t('ai.knowledge.system.descriptionPlaceholder')" /></label>
    <p class="system-form-hint">{{ t('ai.knowledge.system.editHint') }}</p>
    <fieldset v-for="(node, index) in model.nodes" :key="node.id" class="system-node-form" :disabled="disabled"><legend>{{ t('ai.knowledge.system.role') }} {{ index + 1 }}</legend>
      <label>{{ t('ai.knowledge.system.service') }}<input v-model="node.role" maxlength="80" :placeholder="t('ai.knowledge.system.servicePlaceholder')" /></label>
      <label>{{ t('ai.knowledge.server') }}<select :value="node.connectionId" @change="selectMember(index, $event)"><option v-if="!members.some(member => member.connectionId === node.connectionId && member.binding === node.binding && member.available)" :value="node.connectionId">{{ t('ai.knowledge.system.memberChanged') }}</option><option v-for="member in members" :key="member.connectionId" :value="member.connectionId" :disabled="!member.available">{{ member.name }}</option></select></label>
      <label>{{ t('ai.knowledge.system.status') }}<select v-model="node.status"><option value="unconfirmed">{{ t('ai.knowledge.system.unconfirmed') }}</option><option value="confirmed">{{ t('ai.knowledge.system.confirmed') }}</option></select></label>
      <label>{{ t('ai.knowledge.system.note') }}<input v-model="node.note" maxlength="300" /></label>
      <button type="button" class="ui-btn ui-btn-xs" @click="removeNode(node.id)">{{ t('common.delete') }}</button>
    </fieldset>
    <button type="button" class="ui-btn ui-btn-sm system-add-node" :disabled="disabled || !members.some(member => member.available) || model.nodes.length >= SYSTEM_MAX_NODES" @click="addNode">{{ t('ai.knowledge.system.addRole') }}</button>
    <fieldset v-for="(edge, index) in model.dependencies" :key="index" class="system-edge-form" :disabled="disabled"><legend>{{ t('ai.knowledge.system.dependency') }} {{ index + 1 }}</legend>
      <label>{{ t('ai.knowledge.system.from') }}<select v-model="edge.from"><option v-for="node in model.nodes" :key="node.id" :value="node.id">{{ node.role || node.id }}</option></select></label>
      <label>{{ t('ai.knowledge.system.to') }}<select v-model="edge.to"><option v-for="node in model.nodes" :key="node.id" :value="node.id" :disabled="node.id === edge.from">{{ node.role || node.id }}</option></select></label>
      <label>{{ t('ai.knowledge.system.purpose') }}<input v-model="edge.label" maxlength="120" /></label>
      <label>{{ t('ai.knowledge.system.status') }}<select v-model="edge.status"><option value="unconfirmed">{{ t('ai.knowledge.system.unconfirmed') }}</option><option value="confirmed">{{ t('ai.knowledge.system.confirmed') }}</option></select></label>
      <button type="button" class="ui-btn ui-btn-xs" @click="model.dependencies.splice(index, 1)">{{ t('common.delete') }}</button>
    </fieldset>
    <button type="button" class="ui-btn ui-btn-sm system-add-edge" :disabled="disabled || model.nodes.length < 2 || model.dependencies.length >= SYSTEM_MAX_DEPENDENCIES" @click="addDependency">{{ t('ai.knowledge.system.addDependency') }}</button>
  </div>
</template>

<style scoped>
.knowledge-system-form { display: flex; flex-direction: column; gap: 10px; }
label { display: flex; flex-direction: column; gap: 5px; min-width: 0; font-size: var(--font-caption); }
input, select, textarea { box-sizing: border-box; width: 100%; min-width: 0; padding: 7px; color: var(--text-primary); background: var(--bg-secondary); border: 1px solid var(--border-color); border-radius: 5px; font: inherit; }
textarea { resize: vertical; min-height: 70px; }
fieldset { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding: 10px; margin: 0; min-width: 0; border: 1px solid var(--border-color); border-radius: 6px; }
legend { font-size: var(--font-caption); font-weight: 600; } button { justify-self: start; align-self: start; }
.system-form-hint { margin: 0; color: var(--text-secondary); font-size: var(--font-caption); line-height: 1.6; }
@media (max-width: 600px) { fieldset { grid-template-columns: minmax(0, 1fr); } }
</style>
