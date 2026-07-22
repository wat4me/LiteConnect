<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { KEYBOARD_SHORTCUTS } from '../../composables/useTheme'

const { t } = useI18n()

const shortcuts = computed(() =>
  KEYBOARD_SHORTCUTS.map((item) => ({
    keys: item.keysKey ? t(item.keysKey) : item.keys,
    desc: t(item.descKey),
    scope: t(item.scopeKey),
  })),
)
</script>

<template>
  <section class="settings-content">
    <header class="content-header">
      <h3>{{ t('settingsShortcuts.title') }}</h3>
      <p>{{ t('settingsShortcuts.intro') }}</p>
    </header>
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

.settings-card {
  border: 1px solid var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
  padding: 16px;
}

.settings-card.narrow {
  max-width: 520px;
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
