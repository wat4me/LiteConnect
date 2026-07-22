<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

const STORAGE_KEY = 'LiteConnect.onboardingTips.v1'
const { t } = useI18n()

const tips = computed(() => [
  { title: t('connections.tipQuickConnectTitle'), body: t('connections.tipQuickConnectBody') },
  { title: t('connections.tipSnippetsTitle'), body: t('connections.tipSnippetsBody') },
  { title: t('connections.tipSidebarTitle'), body: t('connections.tipSidebarBody') },
])

const visible = ref(false)
const index = ref(0)

onMounted(() => {
  try {
    if (localStorage.getItem(STORAGE_KEY) === '1') return
  } catch {}
  visible.value = true
})

function dismiss() {
  visible.value = false
  try {
    localStorage.setItem(STORAGE_KEY, '1')
  } catch {}
}

function next() {
  if (index.value >= tips.value.length - 1) {
    dismiss()
    return
  }
  index.value += 1
}
</script>

<template>
  <div v-if="visible" class="onboarding" role="dialog" :aria-label="t('connections.onboardingAria')">
    <div class="onboarding-card">
      <div class="onboarding-kicker">{{ t('connections.onboardingWelcome', { current: index + 1, total: tips.length }) }}</div>
      <div class="onboarding-title">{{ tips[index].title }}</div>
      <div class="onboarding-body">{{ tips[index].body }}</div>
      <div class="onboarding-actions">
        <button type="button" class="ui-btn ui-btn-sm" @click="dismiss">{{ t('connections.onboardingSkip') }}</button>
        <button type="button" class="ui-btn ui-btn-sm ui-btn-primary" @click="next">
          {{ index >= tips.length - 1 ? t('connections.onboardingStart') : t('connections.onboardingNext') }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.onboarding {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 12000;
  max-width: min(360px, calc(100vw - 24px));
}

.onboarding-card {
  padding: 14px 14px 12px;
  border-radius: 12px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.28);
}

.onboarding-kicker {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.onboarding-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.onboarding-body {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary);
}

.onboarding-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}
</style>
