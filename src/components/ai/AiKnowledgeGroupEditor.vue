<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import AiKnowledge from './AiKnowledge.vue'

const props = defineProps<{ groupId: string; active: boolean }>()
const emit = defineEmits<{ (event: 'close'): void }>()
const knowledge = ref<InstanceType<typeof AiKnowledge>>()
async function show() { await nextTick(); if (props.active) await knowledge.value?.show(undefined, undefined, true) }
onMounted(show)
watch(() => props.groupId, show)
</script>

<template><AiKnowledge ref="knowledge" session-id="" :group-id="groupId" :active="active" :busy="false" @close="emit('close')" /></template>
