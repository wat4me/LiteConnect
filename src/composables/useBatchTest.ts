import { ref, onBeforeUnmount, type Ref, type ComputedRef } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { Connection } from '../env.d.ts'
import { t } from '../i18n'

export interface TestStatus {
  state: 'idle' | 'testing' | 'success' | 'error'
  latency?: number
  error?: string
}

type FilteredConnectionsSource =
  | Ref<Connection[]>
  | ComputedRef<Connection[]>
  | (() => Connection[])

function resolveFiltered(source: FilteredConnectionsSource): Connection[] {
  if (typeof source === 'function') return source()
  return source.value
}

export function useBatchTest(filteredConnections: FilteredConnectionsSource) {
  const testStatuses = ref<Map<string, TestStatus>>(new Map())
  const testTimers = ref<Map<string, ReturnType<typeof setTimeout>>>(new Map())
  const batchTesting = ref(false)

  function clearTestTimer(connectionId: string) {
    const timer = testTimers.value.get(connectionId)
    if (timer) {
      clearTimeout(timer)
      testTimers.value.delete(connectionId)
    }
  }

  async function onTestConnection(connectionId: string) {
    clearTestTimer(connectionId)
    testStatuses.value.set(connectionId, { state: 'testing' })

    try {
      const result = await window.LiteConnect.sshTestConnection(connectionId)
      if (result.ok) {
        testStatuses.value.set(connectionId, { state: 'success', latency: result.latency })
        const timer = setTimeout(() => {
          if (testStatuses.value.get(connectionId)?.state === 'success') {
            testStatuses.value.delete(connectionId)
          }
        }, 10000)
        testTimers.value.set(connectionId, timer)
      } else {
        testStatuses.value.set(connectionId, { state: 'error', error: result.error || t('connections.connectFailed') })
        const timer = setTimeout(() => {
          if (testStatuses.value.get(connectionId)?.state === 'error') {
            testStatuses.value.delete(connectionId)
          }
        }, 10000)
        testTimers.value.set(connectionId, timer)
      }
    } catch (err: any) {
      testStatuses.value.set(connectionId, { state: 'error', error: err.message || t('connections.testFailed') })
      const timer = setTimeout(() => {
        if (testStatuses.value.get(connectionId)?.state === 'error') {
          testStatuses.value.delete(connectionId)
        }
      }, 10000)
      testTimers.value.set(connectionId, timer)
    }
  }

  /** 对本列表（当前分组/筛选结果）批量测连通，并发上限 4 */
  async function onBatchTestGroup() {
    const list = resolveFiltered(filteredConnections)
    if (list.length === 0 || batchTesting.value) return
    batchTesting.value = true
    let ok = 0
    let fail = 0
    const concurrency = 4
    let cursor = 0

    async function worker() {
      while (cursor < list.length) {
        const idx = cursor++
        const conn = list[idx]
        if (!conn) continue
        await onTestConnection(conn.id)
        const st = testStatuses.value.get(conn.id)
        if (st?.state === 'success') ok++
        else fail++
      }
    }

    try {
      await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()))
      ElMessage.success(t('connections.batchTestDone', { ok, fail }))
    } finally {
      batchTesting.value = false
    }
  }

  function getTestStatus(connectionId: string): TestStatus {
    return testStatuses.value.get(connectionId) || { state: 'idle' }
  }

  onBeforeUnmount(() => {
    for (const [, timer] of testTimers.value) {
      clearTimeout(timer)
    }
  })

  return {
    testStatuses,
    batchTesting,
    onTestConnection,
    onBatchTestGroup,
    getTestStatus,
  }
}
