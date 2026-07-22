<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Connection } from '../env.d.ts'

const props = defineProps<{
  visible: boolean
  connections: Connection[]
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'connect', connectionId: string): void
  (e: 'open-home'): void
  (e: 'open-settings'): void
}>()

const { t } = useI18n()
const query = ref('')
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

type JumpItem =
  | { kind: 'action'; id: string; title: string; subtitle: string }
  | { kind: 'connection'; id: string; title: string; subtitle: string; connectionId: string }

const actions = computed<JumpItem[]>(() => [
  { kind: 'action', id: 'home', title: t('connections.actionOpenHome'), subtitle: t('connections.actionOpenHomeSub') },
  { kind: 'action', id: 'settings', title: t('connections.actionOpenSettings'), subtitle: t('connections.actionOpenSettingsSub') },
])

const items = computed<JumpItem[]>(() => {
  const q = query.value.trim().toLowerCase()
  const list: JumpItem[] = []
  for (const a of actions.value) {
    if (!q || a.title.toLowerCase().includes(q) || a.subtitle.toLowerCase().includes(q)) {
      list.push(a)
    }
  }
  for (const c of props.connections) {
    const hay = `${c.name} ${c.host} ${c.username} ${c.note || ''} ${c.colorTag || ''}`.toLowerCase()
    if (!q || hay.includes(q)) {
      list.push({
        kind: 'connection',
        id: `c-${c.id}`,
        title: c.name,
        subtitle: `${c.username}@${c.host}:${c.port}`,
        connectionId: c.id,
      })
    }
  }
  return list.slice(0, 40)
})

watch(
  () => props.visible,
  async (v) => {
    if (!v) return
    query.value = ''
    activeIndex.value = 0
    await nextTick()
    inputRef.value?.focus()
  },
)

watch(items, (list) => {
  if (activeIndex.value >= list.length) activeIndex.value = Math.max(0, list.length - 1)
})

function pick(item: JumpItem) {
  if (item.kind === 'action') {
    if (item.id === 'home') emit('open-home')
    if (item.id === 'settings') emit('open-settings')
  } else {
    emit('connect', item.connectionId)
  }
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    emit('close')
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    if (items.value.length === 0) return
    activeIndex.value = (activeIndex.value + 1) % items.value.length
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    if (items.value.length === 0) return
    activeIndex.value = (activeIndex.value - 1 + items.value.length) % items.value.length
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const item = items.value[activeIndex.value]
    if (item) pick(item)
  }
}
</script>

<template>
  <div v-if="visible" class="jump-overlay" @click="emit('close')">
    <div class="jump-panel" role="dialog" :aria-label="t('connections.jumpAria')" @click.stop @keydown="onKeydown">
      <input
        ref="inputRef"
        v-model="query"
        class="jump-input"
        type="text"
        :placeholder="t('connections.jumpPlaceholder')"
        :aria-label="t('connections.jumpSearchAria')"
      />
      <div class="jump-list">
        <button
          v-for="(item, index) in items"
          :key="item.id"
          type="button"
          class="jump-item"
          :class="{ active: index === activeIndex }"
          @mouseenter="activeIndex = index"
          @click="pick(item)"
        >
          <span class="jump-title">{{ item.title }}</span>
          <span class="jump-sub">{{ item.subtitle }}</span>
        </button>
        <div v-if="items.length === 0" class="jump-empty">{{ t('connections.jumpEmpty') }}</div>
      </div>
      <div class="jump-hint">{{ t('connections.jumpHint') }}</div>
    </div>
  </div>
</template>

<style scoped>
.jump-overlay {
  position: fixed;
  inset: 0;
  z-index: 13000;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  justify-content: center;
  padding-top: min(18vh, 120px);
}

.jump-panel {
  width: min(520px, calc(100vw - 24px));
  max-height: min(60vh, 480px);
  display: flex;
  flex-direction: column;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.jump-input {
  width: 100%;
  border: none;
  border-bottom: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
  padding: 14px 16px;
  outline: none;
  box-sizing: border-box;
}

.jump-list {
  overflow-y: auto;
  padding: 6px;
  flex: 1;
  min-height: 0;
}

.jump-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 8px;
  padding: 8px 10px;
  cursor: pointer;
  color: var(--text-primary);
}

.jump-item:hover,
.jump-item.active {
  background: var(--hover-bg);
}

.jump-title {
  font-size: 13px;
  font-weight: 600;
}

.jump-sub {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.jump-empty {
  padding: 16px;
  text-align: center;
  color: var(--text-secondary);
  font-size: 12px;
}

.jump-hint {
  padding: 8px 12px;
  border-top: 1px solid var(--border-color);
  font-size: 10px;
  color: var(--text-secondary);
}
</style>
