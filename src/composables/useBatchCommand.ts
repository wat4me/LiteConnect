import { ref, computed } from 'vue'
import { resolveSnippetCommand } from '../utils/commandSnippets'
import { t } from '../i18n'

export interface BatchCommandTarget {
  id: string
  connectionName: string
  sshAddress: string
  tabNumber: number
  terminalLabel: string
  displayName: string
  /** For per-session snippet variable expansion */
  host?: string
  user?: string
  port?: number
  connectionId?: string
}

export interface BatchCommandResult {
  sessionId: string
  connectionName: string
  sshAddress: string
  tabNumber: number
  terminalLabel: string
  displayName: string
  command: string
  output: string
  status: 'pending' | 'running' | 'success' | 'error' | 'cancelled'
  error?: string
  startedAt?: number
  completedAt?: number
}

export interface BatchHistoryItem {
  id: string
  command: string
  at: number
  success: number
  error: number
  cancelled: number
  total: number
}

const HISTORY_KEY = 'LiteConnect.batchCommandHistory'
const HISTORY_LIMIT = 20

function stripAnsi(text: string): string {
  return text
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[()][AB012]/g, '')
    .replace(/\x0f|\x0e/g, '')
    .replace(/\r/g, '')
}

function loadHistory(): BatchHistoryItem[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_LIMIT) : []
  } catch {
    return []
  }
}

function saveHistory(items: BatchHistoryItem[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, HISTORY_LIMIT)))
  } catch {}
}

export function useBatchCommand() {
  const results = ref<BatchCommandResult[]>([])
  const isRunning = ref(false)
  const command = ref('')
  const recentHistory = ref<BatchHistoryItem[]>(loadHistory())
  let runToken = 0

  const hasResults = computed(() => results.value.length > 0)
  const successCount = computed(() => results.value.filter(r => r.status === 'success').length)
  const errorCount = computed(() => results.value.filter(r => r.status === 'error').length)
  const cancelledCount = computed(() => results.value.filter(r => r.status === 'cancelled').length)
  const pendingCount = computed(() => results.value.filter(r => r.status === 'pending' || r.status === 'running').length)

  function expandForSessions(sessions: BatchCommandTarget[], cmd: string) {
    return sessions.map((s) => {
      const expanded = resolveSnippetCommand(cmd, {
        host: s.host,
        user: s.user,
        port: s.port,
        name: s.connectionName,
      })
      return {
        sessionId: s.id,
        connectionName: s.connectionName,
        sshAddress: s.sshAddress,
        tabNumber: s.tabNumber,
        terminalLabel: s.terminalLabel,
        displayName: s.displayName,
        command: expanded,
      }
    })
  }

  async function executeBatch(
    sessions: BatchCommandTarget[],
    cmd: string,
    timeoutMs = 30000,
  ) {
    if (!cmd.trim() || sessions.length === 0) return
    if (isRunning.value) return

    const token = ++runToken
    isRunning.value = true
    command.value = cmd
    results.value = expandForSessions(sessions, cmd).map((row) => ({
      ...row,
      output: '',
      status: 'pending' as const,
    }))

    const promises = results.value.map(async (result) => {
      if (token !== runToken) {
        result.status = 'cancelled'
        result.error = t('batch.cancelled')
        result.completedAt = Date.now()
        return
      }
      result.status = 'running'
      result.startedAt = Date.now()

      try {
        const output = await window.LiteConnect.sshExec(result.sessionId, result.command, timeoutMs)
        if (token !== runToken) {
          result.status = 'cancelled'
          result.error = t('batch.cancelled')
          result.output = stripAnsi(output || '')
        } else {
          result.output = stripAnsi(output)
          result.status = 'success'
        }
      } catch (err: any) {
        if (token !== runToken) {
          result.status = 'cancelled'
          result.error = t('batch.cancelled')
        } else {
          result.error = err.message || 'Command failed'
          result.output = stripAnsi(result.error || '')
          result.status = 'error'
        }
      }
      result.completedAt = Date.now()
    })

    await Promise.all(promises)
    if (token === runToken) {
      isRunning.value = false
      pushHistory({
        command: cmd,
        success: successCount.value,
        error: errorCount.value,
        cancelled: cancelledCount.value,
        total: results.value.length,
      })
      window.dispatchEvent(new CustomEvent('batch-command-finished', {
        detail: {
          command: cmd,
          success: successCount.value,
          error: errorCount.value,
          cancelled: cancelledCount.value,
          total: results.value.length,
        },
      }))
    }
  }

  function cancelBatch() {
    if (!isRunning.value) return
    runToken++
    isRunning.value = false
    for (const r of results.value) {
      if (r.status === 'pending' || r.status === 'running') {
        r.status = 'cancelled'
        r.error = t('batch.cancelled')
        r.completedAt = Date.now()
      }
    }
    pushHistory({
      command: command.value,
      success: successCount.value,
      error: errorCount.value,
      cancelled: cancelledCount.value,
      total: results.value.length,
    })
    window.dispatchEvent(new CustomEvent('batch-command-finished', {
      detail: {
        command: command.value,
        success: successCount.value,
        error: errorCount.value,
        cancelled: cancelledCount.value,
        total: results.value.length,
        cancelledByUser: true,
      },
    }))
  }

  function pushHistory(entry: Omit<BatchHistoryItem, 'id' | 'at'>) {
    const item: BatchHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      at: Date.now(),
      ...entry,
    }
    recentHistory.value = [item, ...recentHistory.value.filter((h) => h.command !== entry.command)].slice(0, HISTORY_LIMIT)
    saveHistory(recentHistory.value)
  }

  function clearResults() {
    if (isRunning.value) cancelBatch()
    results.value = []
    command.value = ''
  }

  function exportResults(): string {
    const lines: string[] = [
      `# Batch results · ${new Date().toISOString()}`,
      `# Command template: ${command.value}`,
      '',
    ]
    for (const r of results.value) {
      lines.push(`## ${r.displayName} (${r.sshAddress})`)
      lines.push(`Status: ${r.status}`)
      lines.push(`Command: ${r.command}`)
      if (r.error) lines.push(`Error: ${r.error}`)
      if (r.output) {
        lines.push('```')
        lines.push(r.output)
        lines.push('```')
      }
      lines.push('')
    }
    return lines.join('\n')
  }

  return {
    results,
    isRunning,
    command,
    hasResults,
    successCount,
    errorCount,
    cancelledCount,
    pendingCount,
    recentHistory,
    expandForSessions,
    executeBatch,
    cancelBatch,
    clearResults,
    exportResults,
  }
}
