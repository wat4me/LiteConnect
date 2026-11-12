<script setup lang="ts">
import { ref } from 'vue'
import TabBar from '../../src/components/app/TabBar.vue'

const hosts = Array.from({ length: 14 }, (_, i) => ({
  connectionId: `host-${i}`,
  connectionName: `10.2.5.${70 + i}`,
  activeSessionId: `session-${i}`,
  sessions: [{ id: `session-${i}` }],
}))

const groups = ref(hosts)
const activeGroupId = ref<string | null>('host-13')
const homeActive = ref(false)

;(window as any).LiteConnect = {
  onMcpJobsChanged: () => () => {},
  mcpListJobs: async () => [],
}

;(window as any).__tabs = {
  setActive: (id: string | null) => { activeGroupId.value = id },
  setHome: (value: boolean) => { homeActive.value = value },
  state: () => ({ active: activeGroupId.value, count: groups.value.length }),
}
</script>

<template>
  <div style="width: 100vw">
    <TabBar
      :groups="groups"
      :active-group-id="activeGroupId"
      :recent-connections="[]"
      :latency-map="null"
      :latency-enabled="false"
      :home-active="homeActive"
    />
  </div>
</template>
