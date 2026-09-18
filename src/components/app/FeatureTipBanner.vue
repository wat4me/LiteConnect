<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { markTipSeen, shouldShowTip } from '@/utils/shared/featureTips'
import AppIcon from '@/components/icons/AppIcon.vue'

const props = defineProps<{
  tipKey: string
  title: string
  body: string
}>()

const { t } = useI18n()
const visible = ref(false)

onMounted(() => {
  visible.value = shouldShowTip(props.tipKey)
})

function dismiss() {
  visible.value = false
  markTipSeen(props.tipKey)
}
</script>

<template>
  <div v-if="visible" class="feature-tip" role="status">
    <div class="feature-tip-main">
      <div class="feature-tip-title">{{ title }}</div>
      <div class="feature-tip-body">{{ body }}</div>
    </div>
    <button
      type="button"
      class="ui-icon-btn ui-icon-btn-ghost ui-icon-btn-sm ui-icon-btn-close"
      :title="t('common.close')"
      :aria-label="t('common.close')"
      @click="dismiss"
    >
      <AppIcon name="close" size="xs" />
    </button>
  </div>
</template>

<style scoped>
.feature-tip {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border-color));
  background: color-mix(in srgb, var(--accent) 10%, var(--bg-primary));
  flex-shrink: 0;
}

.feature-tip-main {
  min-width: 0;
  flex: 1;
}

.feature-tip-title {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 2px;
}

.feature-tip-body {
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary);
}
</style>
