<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import SftpDirTree from '../../src/components/sftp/SftpDirTree.vue'
import DbResultGrid from '../../src/components/database/DbResultGrid.vue'
import DockerContainerLogsPanel from '../../src/components/docker/DockerContainerLogsPanel.vue'
import { resultToCsv } from '../../src/domain/database/dbFormat'
import type { FileEntry, DockerLogEntry } from '../../src/env'

const view = ref('sftp')
const currentPath = ref('/')
const tree = ref<InstanceType<typeof SftpDirTree> | null>(null)
const files: FileEntry[] = Array.from({ length: 5000 }, (_, index) => ({
  name: 'file-' + String(index).padStart(5, '0') + '.txt', path: '/file-' + String(index).padStart(5, '0') + '.txt',
  isDirectory: false, isSymlink: false, size: index + 1, modifyTime: 1, permissions: '-rw-r--r--',
}))
const dirs = files.map(file => ({ ...file, name: file.name.replace('.txt', ''), path: file.path.replace('.txt', ''), isDirectory: true }))
const directoryMode = ref(false)
const entriesOf = (path: string) => path === '/' ? directoryMode.value ? dirs : files : []
const columns = ['id', 'name', 'payload', 'nullable', 'binary']
const allRows = Array.from({ length: 5000 }, (_, index) => ({
  id: index, name: 'record-' + index, payload: { index, text: '内容'.repeat(index % 20) }, nullable: null, binary: '<BLOB 1024 bytes>',
}))
const descending = ref(false)
const filter = ref('')
const rows = computed(() => {
  const result = allRows.filter(row => row.name.includes(filter.value))
  return descending.value ? result.reverse() : result
})
const entries = ref<DockerLogEntry[]>([])
const autoScroll = ref(true)
const copied: unknown[] = []
const downloads: FileEntry[][] = []
let sequence = 0
function append(count: number, long = false) {
  const next = Array.from({ length: count }, () => {
    const id = ++sequence
    return { sequence: id, stream: 'stdout' as const, timestamp: null, text: 'line-' + id + (id % 100 === 0 ? ' MATCH' : '') + (long ? ' wrapping text '.repeat(80) : '') }
  })
  entries.value = [...entries.value, ...next].slice(-10000)
}
window.LiteConnect = { clipboardWriteText: async (text: string) => { copied.push(text) } } as typeof window.LiteConnect
window.addEventListener('error', event => { (window as any).__largeError = String(event.error || event.message) })
onMounted(() => {
  ;(window as any).__large = {
    copied, downloads,
    async view(value: string) { view.value = value; await nextTick() },
    async dirs(value: boolean) { directoryMode.value = value; currentPath.value = '/'; await nextTick() },
    async locate(path: string) { currentPath.value = path; await nextTick() },
    async reveal(path: string) { tree.value?.revealPath(path); await nextTick() },
    async filter(value: string) { filter.value = value; await nextTick() },
    csv: () => resultToCsv(columns, rows.value),
    append,
  }
})
</script>

<template>
  <div class="large-fixture">
    <SftpDirTree v-if="view === 'sftp'" ref="tree" :current-path="currentPath" :entries-of="entriesOf" :is-expanded="() => false" :is-loading="() => false" @select-dir="currentPath = $event" @download-many="downloads.push($event)" />
    <DbResultGrid v-if="view === 'database'" :columns="columns" :rows="rows" :sort="{ col: 'id', dir: descending ? 'desc' : 'asc' }" :row-number-start="101" @sort="descending = !descending" @copy-cell="copied.push($event)" />
    <DockerContainerLogsPanel v-if="view === 'logs'" :entries="entries" :dropped-count="Math.max(0, sequence - 10000)" stream-state="streaming" :stream-error-code="null" :tail="200" :follow="true" :auto-scroll="autoScroll" :active="true" @set-auto-scroll="autoScroll = $event" @clear="entries = []" />
  </div>
</template>

<style>
#app, .large-fixture { height: 100vh; display: flex; flex-direction: column; min-height: 0; }
.large-fixture { max-width: 100vw; padding: 12px; box-sizing: border-box; }
*, *::before, *::after { animation: none !important; transition: none !important; }
</style>
