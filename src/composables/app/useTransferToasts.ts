import { onBeforeUnmount, onMounted } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { t } from '@/i18n'
import {
  createTransferToastCoalescer,
  type TransferToastDirection,
  type TransferToastSummary,
} from '@/utils/sftp/transferToastCoalescer'

function showTransferSummary(d: TransferToastSummary) {
  const failed = d.error + d.partial
  if (d.single && d.total === 1) {
    if (d.single.status === 'cancelled') return
    const name = d.single.fileName || t('common.file')
    const dirLabel = d.direction === 'upload' ? t('common.upload') : t('common.download')
    if (d.single.status === 'completed') {
      ElMessage.success(t('app.transferComplete', { direction: dirLabel, name }))
    } else if (d.single.status === 'error') {
      ElMessage.error(
        d.single.error
          ? t('app.transferFailedWithError', { direction: dirLabel, name, error: d.single.error })
          : t('app.transferFailed', { direction: dirLabel, name }),
      )
    }
    return
  }

  if (d.cancelled > 0 && d.success === 0 && failed === 0 && d.skipped === 0) {
    ElMessage.info(t('app.batchCancelled', {
      success: d.success,
      error: failed,
      cancelled: d.cancelled,
    }))
    return
  }
  if (d.direction === 'download') {
    if (failed > 0) ElMessage.warning(t('app.batchDownloadDoneWithError', { success: d.success, error: failed, total: d.total }))
    else if (d.skipped > 0 && d.success === 0) ElMessage.info(t('app.batchDownloadSkipped', { skipped: d.skipped, total: d.total }))
    else ElMessage.success(t('app.batchDownloadComplete', { count: d.success || d.total }))
    return
  }
  if (failed > 0) ElMessage.warning(t('app.batchUploadDoneWithError', { success: d.success, error: failed, total: d.total }))
  else if (d.skipped > 0 && d.success === 0) ElMessage.info(t('app.batchUploadSkipped', { skipped: d.skipped, total: d.total }))
  else ElMessage.success(t('app.batchUploadComplete', { count: d.success || d.total }))
}

const sftpToastCoalescer = createTransferToastCoalescer(showTransferSummary)

function onTransferFinished(e: Event) {
  const d = (e as CustomEvent).detail as {
    fileName?: string
    direction?: string
    status?: string
    error?: string
  } | undefined
  if (!d) return
  const status = d.status as 'completed' | 'error' | 'skipped' | 'partial' | 'cancelled'
  const direction: TransferToastDirection = d.direction === 'upload' ? 'upload' : 'download'
  sftpToastCoalescer.push({
    direction,
    success: status === 'completed' ? 1 : 0,
    error: status === 'error' ? 1 : 0,
    skipped: status === 'skipped' ? 1 : 0,
    partial: status === 'partial' ? 1 : 0,
    cancelled: status === 'cancelled' ? 1 : 0,
    total: 1,
    single: { fileName: d.fileName, error: d.error, status },
  })
}

function onBatchTransferFinished(e: Event) {
  const d = (e as CustomEvent).detail as {
    direction?: string
    success?: number
    error?: number
    skipped?: number
    partial?: number
    cancelled?: number
    total?: number
  } | undefined
  if (!d) return
  sftpToastCoalescer.push({
    direction: d.direction === 'download' ? 'download' : 'upload',
    success: d.success || 0,
    error: d.error || 0,
    skipped: d.skipped || 0,
    partial: d.partial || 0,
    cancelled: d.cancelled || 0,
    total: d.total || 0,
  })
}

function onBatchFinished(e: Event) {
  const d = (e as CustomEvent).detail as {
    success?: number
    error?: number
    cancelled?: number
    total?: number
    cancelledByUser?: boolean
  } | undefined
  if (!d) return
  if (d.cancelledByUser) {
    ElMessage.info(
      t('app.batchCancelled', {
        success: d.success || 0,
        error: d.error || 0,
        cancelled: d.cancelled || 0,
      }),
    )
    return
  }
  if ((d.error || 0) > 0) {
    ElMessage.warning(t('app.batchDoneWithError', { success: d.success || 0, error: d.error || 0 }))
  } else {
    ElMessage.success(t('app.batchDoneAll', { success: d.success || 0, total: d.total || 0 }))
  }
}

/** SFTP per-file / batch transfer and batch-command completion toasts. */
export function useTransferToasts() {
  onMounted(() => {
    window.addEventListener('sftp-transfer-finished', onTransferFinished)
    window.addEventListener('sftp-batch-transfer-finished', onBatchTransferFinished)
    window.addEventListener('batch-command-finished', onBatchFinished)
  })
  onBeforeUnmount(() => {
    sftpToastCoalescer.flushAll()
    window.removeEventListener('sftp-transfer-finished', onTransferFinished)
    window.removeEventListener('sftp-batch-transfer-finished', onBatchTransferFinished)
    window.removeEventListener('batch-command-finished', onBatchFinished)
  })
}
