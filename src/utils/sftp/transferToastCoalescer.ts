export type TransferToastDirection = 'upload' | 'download'

export interface SingleTransferToastDetail {
  fileName?: string
  error?: string
  status: 'completed' | 'error' | 'skipped' | 'partial' | 'cancelled'
}

export interface TransferToastSummary {
  direction: TransferToastDirection
  success: number
  error: number
  skipped: number
  partial: number
  cancelled: number
  total: number
  single?: SingleTransferToastDetail
}

function mergeSummary(
  current: TransferToastSummary | undefined,
  incoming: TransferToastSummary,
): TransferToastSummary {
  if (!current) return { ...incoming }
  return {
    direction: current.direction,
    success: current.success + incoming.success,
    error: current.error + incoming.error,
    skipped: current.skipped + incoming.skipped,
    partial: current.partial + incoming.partial,
    cancelled: current.cancelled + incoming.cancelled,
    total: current.total + incoming.total,
    // Once multiple completion events are combined, a per-file message is misleading.
    single: undefined,
  }
}

/** Coalesce completion bursts by direction so SFTP never floods the page with toasts. */
export function createTransferToastCoalescer(
  onFlush: (summary: TransferToastSummary) => void,
  delayMs = 900,
) {
  const pending = new Map<TransferToastDirection, TransferToastSummary>()
  const timers = new Map<TransferToastDirection, ReturnType<typeof setTimeout>>()

  function flush(direction: TransferToastDirection) {
    const summary = pending.get(direction)
    const timer = timers.get(direction)
    if (timer) clearTimeout(timer)
    timers.delete(direction)
    pending.delete(direction)
    if (summary) onFlush(summary)
  }

  function push(summary: TransferToastSummary) {
    pending.set(summary.direction, mergeSummary(pending.get(summary.direction), summary))
    const currentTimer = timers.get(summary.direction)
    if (currentTimer) clearTimeout(currentTimer)
    timers.set(summary.direction, setTimeout(() => flush(summary.direction), delayMs))
  }

  function flushAll() {
    for (const direction of [...pending.keys()]) flush(direction)
  }

  return { push, flush, flushAll }
}
