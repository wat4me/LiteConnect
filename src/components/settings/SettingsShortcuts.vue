<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { KEYBOARD_SHORTCUTS } from '../../composables/useTheme'
import { resetAllFeatureTips } from '../../utils/featureTips'

const { t } = useI18n()
const resetDone = ref(false)

const shortcuts = computed(() =>
  KEYBOARD_SHORTCUTS.map((item) => ({
    keys: item.keysKey ? t(item.keysKey) : item.keys,
    desc: t(item.descKey),
    scope: t(item.scopeKey),
  })),
)

function handleResetTips() {
  resetAllFeatureTips()
  resetDone.value = true
  ElMessage.success(t('settingsShortcuts.tipsResetDone'))
}
</script>

<template>
  <section class="settings-content">
    <header class="content-header">
      <h3>{{ t('settingsShortcuts.title') }}</h3>
      <p>{{ t('settingsShortcuts.intro') }}</p>
      <p class="content-header-extra">{{ t('settingsShortcuts.overlayIntro') }}</p>
    </header>
    <div class="settings-card narrow tips-card">
      <div class="tips-card-text">
        <div class="shortcut-desc">{{ t('settingsShortcuts.resetTipsTitle') }}</div>
        <div class="shortcut-scope">{{ t('settingsShortcuts.resetTipsDesc') }}</div>
      </div>
      <button type="button" class="ui-btn ui-btn-sm" @click="handleResetTips">
        {{ resetDone ? t('settingsShortcuts.tipsResetDoneShort') : t('settingsShortcuts.resetTips') }}
      </button>
    </div>
    <div class="settings-card narrow">
      <div v-for="item in shortcuts" :key="item.keys + item.desc" class="shortcut-row">
        <kbd class="shortcut-keys">{{ item.keys }}</kbd>
        <div>
          <div class="shortcut-desc">{{ item.desc }}</div>
          <div class="shortcut-scope">{{ item.scope }}</div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.content-header {
  margin-bottom: 20px;
  max-width: 720px;
}

.content-header h3 {
  margin: 0 0 6px;
  font-size: 20px;
  color: var(--text-primary);
}

.content-header p {
  margin: 0;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.content-header-extra {
  margin-top: 6px !important;
}

.settings-card {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
  padding: 16px;
}

.settings-card.narrow {
  max-width: 520px;
}

.tips-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.tips-card-text {
  min-width: 0;
}

.shortcut-row {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-color);
}

.shortcut-row:last-child {
  border-bottom: none;
}

.shortcut-keys {
  flex-shrink: 0;
  min-width: 110px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-primary);
  font-family: ui-monospace, Consolas, monospace;
  font-size: 11px;
  color: var(--text-primary);
  text-align: center;
}

.shortcut-desc {
  font-size: 13px;
  color: var(--text-primary);
  font-weight: 500;
}

.shortcut-scope {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary);
}
</style>
