<script setup lang="ts">
import AppIcon from '@/components/icons/AppIcon.vue'
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appPrompt } from '@/composables/app/useAppDialog'

const { t } = useI18n()
import type { CommandSnippet } from '@/env.d'
import {
  compareSnippets,
  formatSnippetPayloadForWrite,
  pendingSnippetVars,
  resolveDynamicBuiltins,
  resolveSnippetCommand,
  type SnippetContext,
} from '@/utils/snippets/commandSnippets'

const props = defineProps<{
  visible: boolean
  sessionId: string | null
  snippetContext?: SnippetContext | null
  sessions?: Array<{
    id: string
    label: string
    host?: string
    user?: string
    port?: number
    name?: string
  }>
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'ran'): void
}>()

const query = ref('')
const snippets = ref<CommandSnippet[]>([])
const activeIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)
const listRef = ref<HTMLElement | null>(null)

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  let list = [...snippets.value].sort(compareSnippets)
  if (q) {
    list = list.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.command.toLowerCase().includes(q) ||
        (s.group || '').toLowerCase().includes(q),
    )
  }
  return list.slice(0, 50)
})

async function load() {
  try {
    snippets.value = await window.LiteConnect.getCommandSnippets()
  } catch {
    snippets.value = []
  }
}

function contextForSession(sessionId: string | null): SnippetContext | null {
  if (!sessionId) return props.snippetContext || null
  const s = props.sessions?.find((x) => x.id === sessionId)
  if (s && (s.host || s.user)) {
    return { host: s.host, user: s.user, port: s.port, name: s.name }
  }
  return props.snippetContext || null
}

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

async function runItem(item: CommandSnippet) {
  if (!props.sessionId) {
    ElMessage.warning(t('snippets.needTerminal'))
    return
  }
  const resolved = await resolveForContext(item.command, contextForSession(props.sessionId))
  if (resolved === null) return
  const mode = item.sendMode === 'fill' ? 'fill' : 'run'
  window.LiteConnect.sshWrite(props.sessionId, formatSnippetPayloadForWrite(resolved, mode))
  try {
    const next = snippets.value.map((s) =>
      s.id === item.id
        ? { ...s, useCount: (s.useCount || 0) + 1, lastUsedAt: Date.now() }
        : s,
    )
    snippets.value = await window.LiteConnect.setCommandSnippets(next)
  } catch {
    // ignore
  }
  ElMessage.success(mode === 'fill' ? t('snippets.filled', { name: item.name }) : t('snippets.sent', { name: item.name }))
  emit('ran')
  emit('close')
}

function moveActive(delta: number) {
  const n = filtered.value.length
  if (n === 0) {
    activeIndex.value = 0
    return
  }
  activeIndex.value = (activeIndex.value + delta + n) % n
  nextTick(() => {
    const el = listRef.value?.querySelector(`[data-idx="${activeIndex.value}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  })
}

function onKeydown(e: KeyboardEvent) {
  if (!props.visible) return
  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopPropagation()
    emit('close')
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    moveActive(1)
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    moveActive(-1)
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    const item = filtered.value[activeIndex.value]
    if (item) void runItem(item)
  }
}

watch(
  () => props.visible,
  async (v) => {
    if (v) {
      query.value = ''
      activeIndex.value = 0
      await load()
      await nextTick()
      inputRef.value?.focus()
    }
  },
)

watch(query, () => {
  activeIndex.value = 0
})

onMounted(() => {
  document.addEventListener('keydown', onKeydown, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown, true)
})
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="palette-overlay" @mousedown.self="emit('close')">
      <div class="palette-box" role="dialog" :aria-label="t('snippets.paletteAria')">
        <input
          ref="inputRef"
          v-model="query"
          class="palette-input"
          :placeholder="t('snippets.palettePlaceholder')"
          @keydown.stop
        />
        <div ref="listRef" class="palette-list">
          <div v-if="filtered.length === 0" class="palette-empty">{{ t('snippets.noMatch') }}</div>
          <button
            v-for="(item, idx) in filtered"
            :key="item.id"
            type="button"
            class="palette-item"
            :class="{ active: idx === activeIndex }"
            :data-idx="idx"
            @mouseenter="activeIndex = idx"
            @click="runItem(item)"
          >
            <div class="palette-item-top">
              <AppIcon v-if="item.pinned" name="star-fill" size="xs" class="pin" />
              <span class="name">{{ item.name }}</span>
              <span v-if="item.group" class="group">{{ item.group }}</span>
              <span v-if="item.sendMode === 'fill'" class="mode">{{ t('snippets.fill') }}</span>
            </div>
            <code class="cmd">{{ item.command }}</code>
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.palette-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  justify-content: center;
  padding-top: min(18vh, 140px);
}

.palette-box {
  width: min(560px, 92vw);
  max-height: min(60vh, 480px);
  background: var(--bg-primary, #1e1e1e);
  border: 1px solid var(--border-color, #333);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.palette-input {
  border: none;
  border-bottom: 1px solid var(--border-color, #333);
  background: transparent;
  color: var(--text-primary, #eee);
  font-size: 14px;
  padding: 14px 16px;
  outline: none;
}

.palette-list {
  overflow-y: auto;
  flex: 1;
  padding: 6px;
}

.palette-empty {
  padding: 24px;
  text-align: center;
  color: var(--text-secondary, #888);
  font-size: 13px;
}

.palette-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 6px;
  padding: 8px 10px;
  cursor: pointer;
  color: inherit;
}

.palette-item.active,
.palette-item:hover {
  background: var(--hover-bg, rgba(88, 166, 255, 0.15));
}

.palette-item-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 2px;
}

.pin {
  color: var(--warning);
  font-size: 11px;
}

.name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #eee);
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group,
.mode {
  font-size: 10px;
  padding: 0 5px;
  border-radius: 4px;
  background: var(--bg-tertiary, #333);
  color: var(--text-secondary, #aaa);
  flex-shrink: 0;
}

.cmd {
  display: block;
  font-size: 11px;
  color: var(--text-secondary, #999);
  font-family: ui-monospace, Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
