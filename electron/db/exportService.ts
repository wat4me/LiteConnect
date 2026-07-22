import { dialog, type BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import type { DatabaseManager } from './manager'
import type {
  DbBrowseOptions,
  DbExportFormat,
  DbExportProgress,
  DbExportResult,
} from './types'
import {
  createTempExportFile,
  formatCsvHeader,
  formatCsvRow,
  formatJsonlRow,
  openExportWriteStream,
  writeStreamChunk,
  type ExportWriteHandle,
  type TempExportFile,
} from './exportWriter'
import { sanitizeDbErrorText } from './dbError'
import { safeSend } from '../utils/validation'
import { t } from '../i18n'

type ActiveExport = {
  exportId: string
  cancelled: boolean
  writer: ExportWriteHandle | null
  temp: TempExportFile | null
  /** Optional external abort hook (tests / future driver cancel) */
  onCancel?: () => void
}

/**
 * Main-process streaming export (DB-012).
 * Renderer never holds the full result set.
 *
 * Resource contract:
 * - Writer is always destroy/end'd before temp unlink (Windows open-handle safety).
 * - active map entry removed only after cleanup.
 * - Success: end → rename. Failure/cancel: destroy → unlink.
 */
export class DbExportService {
  private active = new Map<string, ActiveExport>()

  constructor(
    private dbManager: DatabaseManager,
    private getMainWindow: () => BrowserWindow | null,
  ) {}

  /** Exposed for tests */
  getActiveCount(): number {
    return this.active.size
  }

  hasActive(exportId: string): boolean {
    return this.active.has(exportId)
  }

  cancel(exportId: string): boolean {
    const a = this.active.get(exportId)
    if (!a) return false
    a.cancelled = true
    try {
      a.onCancel?.()
    } catch {}
    return true
  }

  /**
   * Test / internal: run export with pre-chosen paths (skips save dialog).
   */
  async exportTableToPath(
    input: {
      sessionId: string
      database: string
      table: string
      format?: DbExportFormat
      options?: DbBrowseOptions
      maxRows?: number
    },
    finalPath: string,
  ): Promise<DbExportResult> {
    return this.runExport(input, finalPath)
  }

  async exportTable(input: {
    sessionId: string
    database: string
    table: string
    format?: DbExportFormat
    options?: DbBrowseOptions
    maxRows?: number
    defaultFileName?: string
  }): Promise<DbExportResult> {
    const format: DbExportFormat = input.format === 'jsonl' ? 'jsonl' : 'csv'
    const table = String(input.table || 'export').replace(/[^\w.\-]+/g, '_')
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const defaultName =
      (typeof input.defaultFileName === 'string' && input.defaultFileName.trim())
      || `${table}-all-${stamp}.${format === 'jsonl' ? 'jsonl' : 'csv'}`

    const mainWindow = this.getMainWindow()
    const filters =
      format === 'jsonl'
        ? [{ name: 'JSON Lines', extensions: ['jsonl', 'json'] }]
        : [{ name: 'CSV', extensions: ['csv'] }]
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, {
          title: t('dialog.exportDbConnections') || 'Export',
          defaultPath: defaultName,
          filters,
        })
      : await dialog.showSaveDialog({
          title: 'Export',
          defaultPath: defaultName,
          filters,
        })

    if (result.canceled || !result.filePath) {
      return {
        exportId: uuidv4(),
        ok: false,
        cancelled: true,
        rowsWritten: 0,
      }
    }

    return this.runExport(input, result.filePath)
  }

  private async runExport(
    input: {
      sessionId: string
      database: string
      table: string
      format?: DbExportFormat
      options?: DbBrowseOptions
      maxRows?: number
    },
    finalPath: string,
  ): Promise<DbExportResult> {
    const exportId = uuidv4()
    const format: DbExportFormat = input.format === 'jsonl' ? 'jsonl' : 'csv'
    const maxRows = Math.min(Math.max(input.maxRows ?? 1_000_000, 1), 5_000_000)
    const mainWindow = this.getMainWindow()

    const temp = await createTempExportFile(finalPath)
    const state: ActiveExport = {
      exportId,
      cancelled: false,
      writer: null,
      temp,
    }
    this.active.set(exportId, state)

    const emit = (p: Partial<DbExportProgress> & { phase: DbExportProgress['phase'] }) => {
      const payload: DbExportProgress = {
        exportId,
        rowsWritten: p.rowsWritten ?? 0,
        bytesWritten: p.bytesWritten ?? 0,
        phase: p.phase,
        error: p.error,
        filePath: p.filePath,
      }
      safeSend(mainWindow, 'db:exportProgress', payload)
    }

    let rowsWritten = 0
    let headerWritten = false
    let columns: string[] = []
    let writer: ExportWriteHandle | null = null
    let finalized = false

    const failCleanup = async () => {
      if (writer) {
        await writer.destroy().catch(() => {})
      }
      if (temp && !finalized) {
        await temp.cleanup()
      }
    }

    try {
      emit({ phase: 'running', rowsWritten: 0, bytesWritten: 0 })
      writer = openExportWriteStream(temp.tempPath)
      state.writer = writer
      await writer.whenReady()

      const writeRow = async (row: Record<string, unknown>, cols: string[]) => {
        if (state.cancelled) {
          throw Object.assign(new Error('Export cancelled'), { code: 'EXPORT_CANCELLED' })
        }
        if (!headerWritten) {
          columns = cols.length ? cols : Object.keys(row)
          if (format === 'csv') {
            await writeStreamChunk(writer!.stream, formatCsvHeader(columns))
          }
          headerWritten = true
        }
        const line =
          format === 'jsonl'
            ? formatJsonlRow(columns, row)
            : formatCsvRow(columns, row)
        await writeStreamChunk(writer!.stream, line)
        rowsWritten++
        if (rowsWritten % 200 === 0) {
          emit({
            phase: 'running',
            rowsWritten,
            bytesWritten: writer!.getBytesWritten(),
          })
        }
      }

      const streamResult = await this.dbManager.exportTableStream(
        input.sessionId,
        input.database,
        input.table,
        {
          browse: input.options,
          maxRows,
          format,
          isCancelled: () => state.cancelled,
          onColumns: async (cols) => {
            columns = cols
            if (!headerWritten && format === 'csv' && cols.length) {
              await writeStreamChunk(writer!.stream, formatCsvHeader(cols))
              headerWritten = true
            }
          },
          onRow: writeRow,
        },
      )
      rowsWritten = streamResult.rowsWritten

      if (state.cancelled) {
        await failCleanup()
        emit({
          phase: 'cancelled',
          rowsWritten,
          bytesWritten: writer?.getBytesWritten() ?? 0,
        })
        return { exportId, ok: false, cancelled: true, rowsWritten }
      }

      emit({
        phase: 'finalizing',
        rowsWritten,
        bytesWritten: writer.getBytesWritten(),
      })
      await writer.end()
      await temp.finalize()
      finalized = true
      emit({
        phase: 'done',
        rowsWritten,
        bytesWritten: writer.getBytesWritten(),
        filePath: finalPath,
      })
      return {
        exportId,
        ok: true,
        filePath: finalPath,
        rowsWritten,
      }
    } catch (err: any) {
      const code = err?.code || err?.category
      const cancelled = code === 'EXPORT_CANCELLED' || state.cancelled
      await failCleanup()
      const error = cancelled ? undefined : sanitizeDbErrorText(err?.message || err)
      emit({
        phase: cancelled ? 'cancelled' : 'error',
        rowsWritten,
        bytesWritten: 0,
        error,
      })
      return {
        exportId,
        ok: false,
        cancelled,
        rowsWritten,
        error,
      }
    } finally {
      state.writer = null
      state.temp = null
      this.active.delete(exportId)
    }
  }
}
