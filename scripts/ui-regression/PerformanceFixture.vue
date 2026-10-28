<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import ConnectionsView from '../../src/views/ConnectionsView.vue'
import SettingsRendererPerformance from '../../src/components/settings/SettingsRendererPerformance.vue'
import { useFancyCursor } from '../../src/composables/app/useFancyCursor'
import { recordRendererTiming } from '../../src/composables/app/rendererPerformance'
import { setAppLocale } from '../../src/i18n'
import type { Connection, Group } from '../../src/env'

const data = ref<{ connections: Connection[]; groups: Group[] } | null>(null)
const mountKey = ref(0)
const errors = ref<Record<string, string>>({})
const showDiagnostics = ref(false)
const cursorEnabled = ref(false)
useFancyCursor(cursorEnabled, ref('trail'))
const connects: string[] = []
const reorders: string[][] = []
const groupReorders: string[][] = []
const moves: string[][] = []
let savedSettings: Record<string, unknown> = {}
let hidden = false
Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
let rafCount = 0
const nativeRaf = window.requestAnimationFrame.bind(window)
const nativeCancel = window.cancelAnimationFrame.bind(window)
let fastFrames = false
let fakeFrameId = 0
const pendingFakeFrames = new Set<number>()
window.requestAnimationFrame = callback => {
  rafCount++
  if (!fastFrames) return nativeRaf(callback)
  const id = --fakeFrameId
  pendingFakeFrames.add(id)
  queueMicrotask(() => { if (pendingFakeFrames.delete(id)) callback(performance.now()) })
  return id
}
window.cancelAnimationFrame = id => { if (id < 0) pendingFakeFrames.delete(id); else nativeCancel(id) }
window.addEventListener('error', event => { (window as any).__perfError = String(event.error || event.message) })

;(window as any).LiteConnect = {
  getConnectionUsageStatsEnabled: async () => true,
  getAllSettings: async () => savedSettings,
  setManySettings: async (settings: Record<string, unknown>) => { savedSettings = { ...savedSettings, ...settings } },
  getSavedCredentials: async () => [],
  getConnections: async () => data.value!.connections,
  getGroups: async () => data.value!.groups,
  reorderGroups: async (ids: string[]) => {
    groupReorders.push(ids)
    data.value!.groups = data.value!.groups.map(group => ({ ...group, order: ids.indexOf(group.id) }))
  },
  updateConnectionGroup: async (id: string, group: string) => {
    moves.push([id, group])
    data.value!.connections = data.value!.connections.map(connection => connection.id === id ? { ...connection, group } : connection)
  },
  reorderConnections: async (ids: string[]) => {
    reorders.push(ids)
    const order = new Map(ids.map((id, index) => [id, index]))
    data.value!.connections = data.value!.connections.map(connection => ({ ...connection, order: order.get(connection.id) ?? connection.order }))
  },
}

onMounted(() => {
  ;(window as any).__perf = {
    connects, reorders, groupReorders, moves,
    settings: () => savedSettings,
    async mountAppearance() {
      data.value = null
      await nextTick()
      localStorage.setItem('LiteConnect.connections.density', 'standard')
      data.value = {
        groups: [
          { id: 'servers', name: '默认分组', isDefault: true, order: 0 },
          { id: 'archive', name: '腾讯云', order: 1 },
        ],
        connections: [
          { name: '10.2.178.163', note: '测试备注', colorTag: '' },
          { name: '生产发布机', note: '发布前确认备份完成', colorTag: 'gray' },
          { name: '10.2.178.202', note: '数据库主节点，操作前请先确认目标环境', colorTag: 'blue' },
          { name: '备份服务器', note: '每天 02:00 执行备份', colorTag: 'red' },
          { name: '开发环境', note: '这是一段较长的备注，用来验证窗口变窄时地址与备注的显示。'.repeat(4), colorTag: '' },
        ].map((connection, index) => ({
          ...connection, id: 'host-' + index, host: '10.2.178.' + (163 + index), port: 22, username: 'root',
          group: 'servers', createdAt: 1, updatedAt: 1, order: index, useCount: index === 0 ? 65 : 7,
          lastConnectedAt: new Date('2026-10-27T14:31:00+08:00').getTime(),
        })).concat([{ id: 'archive-host', name: '云服务器', host: '10.9.0.1', port: 22, username: 'ubuntu', group: 'archive', createdAt: 1, updatedAt: 1, order: 5, note: '', colorTag: '', useCount: 0, lastConnectedAt: 0 }]),
      }
      mountKey.value++
      await nextTick()
    },
    async mountDrag() {
      data.value = null
      await nextTick()
      localStorage.setItem('LiteConnect.connections.density', 'standard')
      data.value = {
        groups: [
          { id: 'servers', name: 'Servers', isDefault: true, order: 0 },
          { id: 'archive', name: 'Archive', order: 1 },
          { id: 'child', name: 'Child', parentId: 'archive', order: 2 },
        ],
        connections: Array.from({ length: 3 }, (_, index) => ({
          id: 'host-' + index, name: 'server-' + index, host: 'host-' + index + '.example.test',
          port: 22, username: 'root', group: 'servers', createdAt: 1, updatedAt: 1, order: index,
        })),
      }
      mountKey.value++
      await nextTick()
    },
    async mount(count: number, density = 'standard') {
      data.value = null
      await nextTick()
      localStorage.setItem('LiteConnect.connections.density', density)
      const next = {
        groups: [{ id: 'servers', name: 'Servers', isDefault: true, createdAt: 1, updatedAt: 1 }],
        connections: Array.from({ length: count }, (_, index) => ({
          id: 'host-' + index, name: 'server-' + String(index).padStart(5, '0'), host: 'host-' + index + '.example.test',
          port: 22, username: 'root', group: 'servers', createdAt: 1, updatedAt: 1, order: index,
          note: 'Synthetic benchmark connection',
        })),
      }
      const start = performance.now()
      mountKey.value++
      data.value = next
      await nextTick()
      return { count, density, vueMs: performance.now() - start }
    },
    async hover() {
      const samples: number[] = []
      for (let index = 0; index < 8; index++) {
        const row = document.querySelectorAll('.connection-row-wrap')[index % 2]
        const start = performance.now()
        row.dispatchEvent(new MouseEvent('mouseenter'))
        await nextTick()
        samples.push(performance.now() - start)
      }
      return { medianMs: samples.sort((a, b) => a - b)[4], maxMs: Math.max(...samples) }
    },
    error(id: string) { errors.value = { [id]: 'Connection failed: '.repeat(30) } },
    diagnostics(enabled: boolean) { showDiagnostics.value = enabled; recordRendererTiming('renderer-mounted', 120) },
    cursor(enabled: boolean) { cursorEnabled.value = enabled },
    rafCount: () => rafCount,
    fastFrames(value: boolean) { fastFrames = value },
    hidden(value: boolean) { hidden = value; document.dispatchEvent(new Event('visibilitychange')) },
    locale: setAppLocale,
  }
})
</script>

<template>
  <div class="performance-fixture">
    <ConnectionsView v-if="data" :key="mountKey" :initial-data="data" :connection-errors="errors" @connect="connects.push($event)" />
    <div v-if="showDiagnostics" class="diagnostics-fixture"><SettingsRendererPerformance /></div>
  </div>
</template>

<style>
#app, .performance-fixture { height: 100vh; display: flex; flex-direction: column; min-height: 0; }
.diagnostics-fixture { position: fixed; z-index: 1000; right: 20px; top: 30px; width: min(400px, calc(100vw - 40px)); max-height: calc(100vh - 60px); overflow: auto; padding: 16px; background: var(--bg-primary); border: 1px solid var(--border-color); border-radius: 10px; }
*, *::before, *::after { animation: none !important; transition: none !important; }
</style>
