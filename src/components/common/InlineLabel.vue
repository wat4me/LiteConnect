<script setup lang="ts">
/** Shared single-line text + optional count/badge; icons stay in the parent row. */
defineProps<{ text: string; title?: string }>()
</script>

<template>
  <span class="inline-label">
    <span class="inline-label-text" :title="title ?? text">{{ text }}</span>
    <span v-if="$slots.default" class="inline-label-extra"><slot /></span>
  </span>
</template>

<style scoped>
.inline-label {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
  flex: 1;
  min-width: 0;
  line-height: 1.5;
}

.inline-label-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.inline-label-extra {
  flex-shrink: 0;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
