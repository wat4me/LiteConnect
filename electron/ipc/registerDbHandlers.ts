import { ipcMain, BrowserWindow, dialog } from 'electron'
import { DatabaseManager } from '../db/manager'
import { DbConnectionStore } from '../store/dbConnectionStore'
import { DbQueryHistoryStore } from '../store/dbQueryHistoryStore'
import { CredentialStore } from '../store/credentialStore'
import { sanitizeBrowseOptions } from '../db/browseFilter'
import { DbExportService } from '../db/exportService'
import { SqlScriptImportService } from '../db/scriptImportService'
import { assessSqlRisk } from '../db/sqlRisk'
import { prepareDbQueryRequest } from '../db/prepareDbQuery'
import {
  isValidHost,
  isValidPort,
  isValidUUID,
  isValidUsername,
  safeSend,
} from '../utils/validation'
import { t } from '../i18n'

type MainWindowGetter = () => BrowserWindow | null

export function registerDbHandlers(
  dbStore: DbConnectionStore,
  dbManager: DatabaseManager,
  historyStore: DbQueryHistoryStore,
  credentialStore: CredentialStore,
  getMainWindow: MainWindowGetter,
): void {
  const ensureStore = () => dbStore.init()
  const ensureHistory = () => historyStore.init()
  const exportService = new DbExportService(dbManager, getMainWindow)
  const scriptImportService = new SqlScriptImportService(dbManager, (payload) => {
    safeSend(getMainWindow(), 'db:scriptProgress', payload)
  })

  dbManager.setSessionLostHandler((ev) => {
    safeSend(getMainWindow(), 'db:sessionLost', ev)
  })

  ipcMain.handle('db:listConnections', async () => {
    await ensureStore()
    return dbStore.getConnections()
  })

  ipcMain.handle('db:listGroups', async () => {
    await ensureStore()
    return dbStore.getGroups()
  })

  ipcMain.handle('db:getConnectionPassword', async (_e, id: string) => {
    await ensureStore()
    if (!isValidUUID(id)) throw new Error('Invalid connection id')
    return dbStore.getConnectionPassword(id)
  })

  ipcMain.handle('db:saveConnection', async (_e, input: any) => {
    await ensureStore()
    if (!input || typeof input !== 'object') throw new Error('Invalid connection')
    return await dbStore.saveConnection(input)
  })

  ipcMain.handle('db:deleteConnection', async (_e, id: string) => {
    await ensureStore()
    if (!isValidUUID(id)) throw new Error('Invalid connection id')
    await dbManager.disconnectByConnectionId(id)
    return await dbStore.deleteConnection(id)
  })

  ipcMain.handle('db:reorderConnections', async (_e, orderedIds: string[]) => {
    await ensureStore()
    if (!Array.isArray(orderedIds)) throw new Error('Invalid order')
    for (const id of orderedIds) {
      if (!isValidUUID(id)) throw new Error('Invalid connection id')
    }
    return await dbStore.reorderConnections(orderedIds)
  })

  ipcMain.handle('db:exportConnections', async (_e, includePassword = false) => {
    await ensureStore()
    const payload = dbStore.getConnectionsForExport(!!includePassword)
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showSaveDialog(mainWindow, {
          title: t('dialog.exportDbConnections'),
          defaultPath: 'LiteConnect-db-connections.json',
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
      : await dialog.showSaveDialog({
          title: t('dialog.exportDbConnections'),
          defaultPath: 'LiteConnect-db-connections.json',
          filters: [{ name: 'JSON', extensions: ['json'] }],
        })
    if (result.canceled || !result.filePath) return false
    const { writeFile } = await import('fs/promises')
    await writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf-8')
    return true
  })

  ipcMain.handle('db:importConnections', async () => {
    await ensureStore()
    const mainWindow = getMainWindow()
    if (!mainWindow) return null
    const result = await dialog.showOpenDialog(mainWindow, {
      title: t('dialog.importDbConnections'),
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const { readFile } = await import('fs/promises')
    const data = await readFile(result.filePaths[0], 'utf-8')
    const parsed = JSON.parse(data)
    const list = Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.connections)
        ? parsed.connections
        : null
    if (!list) throw new Error('Invalid import format')
    return await dbStore.importConnections(list)
  })

  ipcMain.handle('db:selectSqlScript', async () => {
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, {
          title: '选择 SQL 文件',
          filters: [{ name: 'SQL', extensions: ['sql'] }],
          properties: ['openFile'],
        })
      : await dialog.showOpenDialog({
          title: '选择 SQL 文件',
          filters: [{ name: 'SQL', extensions: ['sql'] }],
          properties: ['openFile'],
        })
    if (result.canceled || !result.filePaths[0]) return null
    return scriptImportService.rememberFile(result.filePaths[0])
  })

  ipcMain.handle(
    'db:runSqlScript',
    async (_e, sessionId: string, token: string, database?: string) => {
      if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
      if (!isValidUUID(token)) throw new Error('Invalid SQL file selection')
      if (database !== undefined && (typeof database !== 'string' || !database.trim())) {
        throw new Error('Invalid database')
      }
      return scriptImportService.start(sessionId, token, database?.trim())
    },
  )

  ipcMain.handle('db:cancelSqlScript', async (_e, jobId: string) => {
    if (!isValidUUID(jobId)) throw new Error('Invalid SQL script job')
    return scriptImportService.cancel(jobId)
  })

  ipcMain.handle('db:listSshConnections', async () => {
    await credentialStore.init()
    return credentialStore.getConnections().map((c) => ({
      id: c.id,
      name: c.name,
      host: c.host,
      port: c.port,
      username: c.username,
    }))
  })

  ipcMain.handle('db:testConnection', async (_e, params: any) => {
    await ensureStore()
    if (!params || typeof params !== 'object') throw new Error('Invalid params')
    if (!isValidHost(params.host)) throw new Error('Invalid host')
    const engine = params.engine === 'postgres' ? 'postgres' : 'mysql'
    const defaultPort = engine === 'postgres' ? 5432 : 3306
    if (!isValidPort(params.port ?? defaultPort)) throw new Error('Invalid port')
    if (!isValidUsername(params.username)) throw new Error('Invalid username')
    if (typeof params.password !== 'string') throw new Error('Invalid password')

    let password = params.password
    if (!password && params.connectionId && isValidUUID(params.connectionId)) {
      password = dbStore.getConnectionPassword(params.connectionId)
    }

    const sshConnectionId =
      typeof params.sshConnectionId === 'string' && params.sshConnectionId.trim()
        ? params.sshConnectionId.trim()
        : undefined
    if (sshConnectionId && !isValidUUID(sshConnectionId)) {
      throw new Error('Invalid SSH connection id')
    }

    return await dbManager.test({
      engine,
      host: params.host.trim(),
      port: params.port ?? defaultPort,
      username: params.username.trim(),
      password: password || '',
      database: typeof params.database === 'string' ? params.database.trim() : undefined,
      ssl: !!params.ssl,
      sslOptions: params.sslOptions,
      sshConnectionId,
    })
  })

  ipcMain.handle('db:connect', async (_e, connectionId: string) => {
    await ensureStore()
    if (!isValidUUID(connectionId)) throw new Error('Invalid connection id')
    const auth = dbStore.getConnectionForAuth(connectionId)
    if (!auth) throw new Error('Connection not found')
    return await dbManager.connect(auth)
  })

  ipcMain.handle(
    'db:takePendingSessionLost',
    async (_e, connectionId: string, sessionId?: string) => {
      if (!isValidUUID(connectionId)) throw new Error('Invalid connection id')
      if (sessionId !== undefined && sessionId !== null && sessionId !== '') {
        if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
      }
      return dbManager.takePendingSessionLost(
        connectionId,
        typeof sessionId === 'string' && sessionId ? sessionId : undefined,
      )
    },
  )

  ipcMain.handle('db:disconnect', async (_e, sessionId: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    await dbManager.disconnect(sessionId)
  })

  ipcMain.handle('db:disconnectByConnectionId', async (_e, connectionId: string) => {
    if (!isValidUUID(connectionId)) throw new Error('Invalid connection id')
    await dbManager.disconnectByConnectionId(connectionId)
  })

  ipcMain.handle('db:getSession', async (_e, sessionId: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    return dbManager.getSession(sessionId)
  })

  ipcMain.handle('db:listDatabases', async (_e, sessionId: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    return await dbManager.listDatabases(sessionId)
  })

  ipcMain.handle('db:listTables', async (_e, sessionId: string, database?: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (database !== undefined && (typeof database !== 'string' || !database.trim())) {
      throw new Error('Invalid database')
    }
    return await dbManager.listTables(sessionId, database?.trim())
  })

  ipcMain.handle('db:listTableInfos', async (_e, sessionId: string, database?: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (database !== undefined && (typeof database !== 'string' || !database.trim())) {
      throw new Error('Invalid database')
    }
    return await dbManager.listTableInfos(sessionId, database?.trim())
  })

  ipcMain.handle('db:getTableColumns', async (_e, sessionId: string, database: string, table: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (typeof database !== 'string' || !database.trim()) throw new Error('Invalid database')
    if (typeof table !== 'string' || !table.trim()) throw new Error('Invalid table')
    return await dbManager.getTableColumns(sessionId, database.trim(), table.trim())
  })

  ipcMain.handle('db:getTableIndexes', async (_e, sessionId: string, database: string, table: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (typeof database !== 'string' || !database.trim()) throw new Error('Invalid database')
    if (typeof table !== 'string' || !table.trim()) throw new Error('Invalid table')
    return await dbManager.getTableIndexes(sessionId, database.trim(), table.trim())
  })

  ipcMain.handle('db:getCreateTable', async (_e, sessionId: string, database: string, table: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (typeof database !== 'string' || !database.trim()) throw new Error('Invalid database')
    if (typeof table !== 'string' || !table.trim()) throw new Error('Invalid table')
    return await dbManager.getCreateTable(sessionId, database.trim(), table.trim())
  })

  ipcMain.handle(
    'db:browseTable',
    async (
      _e,
      sessionId: string,
      database: string,
      table: string,
      page?: number,
      pageSize?: number,
      options?: any,
    ) => {
      if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
      if (typeof database !== 'string' || !database.trim()) throw new Error('Invalid database')
      if (typeof table !== 'string' || !table.trim()) throw new Error('Invalid table')
      const sanitized = sanitizeBrowseOptions(options)
      return await dbManager.browseTable(
        sessionId,
        database.trim(),
        table.trim(),
        typeof page === 'number' ? page : 1,
        typeof pageSize === 'number' ? pageSize : 100,
        sanitized,
      )
    },
  )

  ipcMain.handle('db:useDatabase', async (_e, sessionId: string, database: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (typeof database !== 'string' || !database.trim()) throw new Error('Invalid database')
    await dbManager.useDatabase(sessionId, database.trim())
  })

  ipcMain.handle(
    'db:createDatabase',
    async (
      _e,
      sessionId: string,
      name: string,
      options?: { charset?: string; collate?: string; encoding?: string; template?: string },
    ) => {
      if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
      if (typeof name !== 'string' || !name.trim()) throw new Error('Invalid database name')
      const trimmed = name.trim()
      if (/[\0]/.test(trimmed)) throw new Error('Invalid database name')
      return await dbManager.createDatabase(sessionId, trimmed, options)
    },
  )

  ipcMain.handle(
    'db:query',
    async (
      _e,
      sessionId: string,
      sql: string,
      options?: {
        maxRows?: number
        timeoutMs?: number
        queryId?: string
        database?: string
        clientKey?: string
        /** When true, reject non-read-only SQL at IPC boundary (DQB-003) */
        readOnly?: boolean
      },
    ) => {
      const prepared = prepareDbQueryRequest(sessionId, sql, options, {
        getDialect: (sid) => {
          const session = dbManager.getSession(sid)
          return session?.engine === 'postgres' ? 'postgres' : 'mysql'
        },
      })
      return await dbManager.query(prepared.sessionId, prepared.sql, prepared.options)
    },
  )

  ipcMain.handle('db:cancelQuery', async (_e, sessionId: string, queryId: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (typeof queryId !== 'string' || !queryId.trim()) throw new Error('Invalid query id')
    return await dbManager.cancelQuery(sessionId, queryId.trim())
  })

  ipcMain.handle('db:explain', async (_e, sessionId: string, sql: string, database?: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (typeof sql !== 'string' || !sql.trim()) throw new Error('Invalid SQL')
    const session = dbManager.getSession(sessionId)
    if (!session) throw new Error('Database session not found')
    const trimmed = sql.trim().replace(/;+\s*$/, '')
    const explainSql =
      session.engine === 'postgres'
        ? `EXPLAIN (ANALYZE false, VERBOSE false, COSTS true, FORMAT TEXT) ${trimmed}`
        : `EXPLAIN ${trimmed}`
    return await dbManager.query(sessionId, explainSql, {
      maxRows: 500,
      timeoutMs: 60_000,
      database: typeof database === 'string' ? database : undefined,
    })
  })

  // ── Transactions (DB-009) ──
  ipcMain.handle(
    'db:beginTransaction',
    async (_e, sessionId: string, clientKey: string, database?: string) => {
      if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
      if (typeof clientKey !== 'string' || !clientKey.trim()) throw new Error('Invalid client key')
      return await dbManager.beginTransaction(
        sessionId,
        clientKey.trim().slice(0, 128),
        typeof database === 'string' ? database : undefined,
      )
    },
  )

  ipcMain.handle('db:commitTransaction', async (_e, sessionId: string, clientKey: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (typeof clientKey !== 'string' || !clientKey.trim()) throw new Error('Invalid client key')
    return await dbManager.commitTransaction(sessionId, clientKey.trim().slice(0, 128))
  })

  ipcMain.handle('db:rollbackTransaction', async (_e, sessionId: string, clientKey: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (typeof clientKey !== 'string' || !clientKey.trim()) throw new Error('Invalid client key')
    return await dbManager.rollbackTransaction(sessionId, clientKey.trim().slice(0, 128))
  })

  ipcMain.handle('db:getTransactionState', async (_e, sessionId: string, clientKey: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (typeof clientKey !== 'string' || !clientKey.trim()) throw new Error('Invalid client key')
    return dbManager.getTransactionState(sessionId, clientKey.trim().slice(0, 128))
  })

  ipcMain.handle('db:releaseClient', async (_e, sessionId: string, clientKey: string) => {
    if (!isValidUUID(sessionId)) throw new Error('Invalid session id')
    if (typeof clientKey !== 'string' || !clientKey.trim()) throw new Error('Invalid client key')
    await dbManager.releaseClient(sessionId, clientKey.trim().slice(0, 128))
  })

  // ── SQL risk (DB-009) — pure assessment for renderer confirm ──
  ipcMain.handle('db:assessSqlRisk', async (_e, sql: string) => {
    if (typeof sql !== 'string') throw new Error('Invalid SQL')
    return assessSqlRisk(sql)
  })

  // ── Streaming export (DB-012) ──
  ipcMain.handle('db:exportTable', async (_e, input: any) => {
    if (!input || typeof input !== 'object') throw new Error('Invalid export request')
    if (!isValidUUID(input.sessionId)) throw new Error('Invalid session id')
    if (typeof input.database !== 'string' || !input.database.trim()) {
      throw new Error('Invalid database')
    }
    if (typeof input.table !== 'string' || !input.table.trim()) throw new Error('Invalid table')
    const sanitized = sanitizeBrowseOptions(input.options)
    return await exportService.exportTable({
      sessionId: input.sessionId,
      database: input.database.trim(),
      table: input.table.trim(),
      format: input.format === 'jsonl' ? 'jsonl' : 'csv',
      options: sanitized,
      maxRows: typeof input.maxRows === 'number' ? input.maxRows : undefined,
      defaultFileName:
        typeof input.defaultFileName === 'string' ? input.defaultFileName : undefined,
    })
  })

  ipcMain.handle('db:cancelExport', async (_e, exportId: string) => {
    if (typeof exportId !== 'string' || !exportId.trim()) throw new Error('Invalid export id')
    return exportService.cancel(exportId.trim())
  })

  // ── Query history (persisted under userData) ──
  ipcMain.handle('db:listQueryHistory', async (_e, connectionId?: string) => {
    await ensureHistory()
    if (connectionId !== undefined && connectionId !== null && connectionId !== '') {
      if (!isValidUUID(connectionId)) throw new Error('Invalid connection id')
      return historyStore.list(connectionId)
    }
    return historyStore.list()
  })

  ipcMain.handle(
    'db:pushQueryHistory',
    async (
      _e,
      input: {
        sql: string
        database?: string
        connectionId?: string
        status?: string
        durationMs?: number
        rowCount?: number
        affectedRows?: number
        errorSummary?: string
        slow?: boolean
      },
    ) => {
      await ensureHistory()
      if (!input || typeof input !== 'object') throw new Error('Invalid history item')
      if (typeof input.sql !== 'string' || !input.sql.trim()) throw new Error('Invalid SQL')
      if (input.connectionId !== undefined && input.connectionId !== null && input.connectionId !== '') {
        if (!isValidUUID(input.connectionId)) throw new Error('Invalid connection id')
      }
      return await historyStore.push({
        sql: input.sql,
        database: typeof input.database === 'string' ? input.database : '',
        connectionId: typeof input.connectionId === 'string' ? input.connectionId : undefined,
        status:
          input.status === 'success' || input.status === 'failed' || input.status === 'cancelled'
            ? input.status
            : undefined,
        durationMs: typeof input.durationMs === 'number' ? input.durationMs : undefined,
        rowCount: typeof input.rowCount === 'number' ? input.rowCount : undefined,
        affectedRows: typeof input.affectedRows === 'number' ? input.affectedRows : undefined,
        errorSummary: typeof input.errorSummary === 'string' ? input.errorSummary : undefined,
        slow: typeof input.slow === 'boolean' ? input.slow : undefined,
      })
    },
  )

  ipcMain.handle('db:clearQueryHistory', async (_e, connectionId?: string) => {
    await ensureHistory()
    if (connectionId !== undefined && connectionId !== null && connectionId !== '') {
      if (!isValidUUID(connectionId)) throw new Error('Invalid connection id')
      return await historyStore.clear(connectionId)
    }
    return await historyStore.clear()
  })

  ipcMain.handle('db:mergeQueryHistoryLegacy', async (_e, items: unknown[]) => {
    await ensureHistory()
    return await historyStore.mergeLegacy(Array.isArray(items) ? items : [])
  })
}
