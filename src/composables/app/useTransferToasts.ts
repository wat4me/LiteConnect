import { onBeforeUnmount, onMounted } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { t } from '@/i18n'

function onTransferFinished(e: Event) {
  const d = (e as CustomEvent).detail as {
    fileName?: string
    direction?: string
    status?: string
    error?: string
  } | undefined
  if (!d) return
  // Per-file toast (single downloads / uploads). Batch multi-file uses onBatchTransferFinished.
  const name = d.fileName || t('common.file')
  const dirLabel = d.direction === 'upload' ? t('common.upload') : t('common.download')
  if (d.status === 'completed') {
    ElMessage.success(t('app.transferComplete', { direction: dirLabel, name }))
  } else if (d.status === 'error') {
    ElMessage.error(
      d.error
        ? t('app.transferFailedWithError', { direction: dirLabel, name, error: d.error })
        : t('app.transferFailed', { direction: dirLabel, name }),
    )
  }
}

function onBatchTransferFinished(e: Event) {
  const d = (e as CustomEvent).detail as {
    direction?: string
    success?: number
    error?: number
    skipped?: number
    partial?: number
    total?: number
  } | undefined
  if (!d) return
  const success = d.success || 0
  const error = d.error || 0
  const skipped = d.skipped || 0
  const total = d.total || 0
  if (d.direction === 'download') {
    if (error > 0) {
      ElMessage.warning(t('app.batchDownloadDoneWithError', { success, error, total }))
    } else if (skipped > 0 && success === 0) {
      ElMessage.info(t('app.batchDownloadSkipped', { skipped, total }))
    } else {
      ElMessage.success(t('app.batchDownloadComplete', { count: success || total }))
    }
    return
  }
  // Future multi-file upload batch
  if (error > 0) {
    ElMessage.warning(t('app.batchUploadDoneWithError', { success, error, total }))
  } else {
    ElMessage.success(t('app.batchUploadComplete', { count: success || total }))
  }
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
    window.removeEventListener('sftp-transfer-finished', onTransferFinished)
    window.removeEventListener('sftp-batch-transfer-finished', onBatchTransferFinished)
    window.removeEventListener('batch-command-finished', onBatchFinished)
  })
}
