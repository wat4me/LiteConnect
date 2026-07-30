import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { basename } from 'path'
import { randomUUID } from 'crypto'
import type { DatabaseManager } from '../manager'
import type { DbEngine } from '../types'

const MAX_FILE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_STATEMENT_CHARS = 16 * 1024 * 1024

export type SqlScriptSelection = { token: string; name: string; size: number }
export type SqlScriptProgress = {
  jobId: string
  state: 'running' | 'completed' | 'failed' | 'cancelled'
  name: string
  size: number
  bytesRead: number
  statements: number
  affectedRows: number
  line: number
  error?: string
}

type SelectedFile = SqlScriptSelection & { path: string; expiresAt: number }
type Job = { id: string; sessionId: string; queryId: string | null; cancelled: boolean }

/**
 * Executes SQL files in the main process. The renderer receives metadata and
 * throttled progress only; script text is never copied into IPC or CodeMirror.
 */
export class SqlScriptImportService {
  private readonly selected = new Map<string, SelectedFile>()
  private readonly jobs = new Map<string, Job>()

  constructor(
    private readonly dbManager: DatabaseManager,
    private readonly send: (payload: SqlScriptProgress) => void,
  ) {}

  async rememberFile(path: string): Promise<SqlScriptSelection> {
    const info = await stat(path)
    if (!info.isFile() || info.size <= 0 || info.size > MAX_FILE_BYTES) {
      throw new Error('SQL file must be a non-empty file no larger than 2 GB')
    }
    const token = randomUUID()
    const selection: SelectedFile = {
      token,
      path,
      name: basename(path),
      size: info.size,
      expiresAt: Date.now() + 10 * 60_000,
    }
    this.selected.set(token, selection)
    return selection
  }

  async start(sessionId: string, token: string, database?: string): Promise<{ jobId: string }> {
    const file = this.selected.get(token)
    this.selected.delete(token)
    if (!file || file.expiresAt < Date.now()) throw new Error('Selected SQL file has expired')
    const session = this.dbManager.getSession(sessionId)
    if (!session) throw new Error('Database session not found')
    const job: Job = { id: randomUUID(), sessionId, queryId: null, cancelled: false }
    this.jobs.set(job.id, job)
    void this.run(job, file, session.engine, database).finally(() => this.jobs.delete(job.id))
    return { jobId: job.id }
  }

  async cancel(jobId: string): Promise<boolean> {
    const job = this.jobs.get(jobId)
    if (!job) return false
    job.cancelled = true
    if (job.queryId) await this.dbManager.cancelQuery(job.sessionId, job.queryId)
    return true
  }

  private async run(job: Job, file: SelectedFile, engine: DbEngine, database?: string): Promise<void> {
    let statements = 0
    let affectedRows = 0
    let bytesRead = 0
    let line = 1
    let lastSent = 0
    const report = (state: SqlScriptProgress['state'], error?: string, force = false) => {
      const now = Date.now()
      if (!force && now - lastSent < 150) return
      lastSent = now
      this.send({ jobId: job.id, state, name: file.name, size: file.size, bytesRead, statements, affectedRows, line, error })
    }
    try {
      report('running', undefined, true)
      for await (const item of streamStatements(file.path, engine, () => job.cancelled)) {
        bytesRead = item.bytesRead
        line = item.line
        if (job.cancelled) break
        statements += 1
        if (engine === 'postgres' && /\bCOPY\b[\s\S]*\bFROM\s+STDIN\b/i.test(item.sql)) {
          throw new Error('PostgreSQL COPY FROM STDIN scripts are not supported yet')
        }
        job.queryId = `script:${job.id}:${statements}`
        const result = await this.dbManager.query(job.sessionId, item.sql, {
          database,
          queryId: job.queryId,
          clientKey: `script:${job.id}`,
          // Import scripts never need to materialize an unbounded SELECT result.
          maxRows: 1_000,
        })
        affectedRows += result.affectedRows || 0
        job.queryId = null
        report('running')
      }
      report(job.cancelled ? 'cancelled' : 'completed', undefined, true)
    } catch (err: any) {
      report(job.cancelled ? 'cancelled' : 'failed', String(err?.message || err).slice(0, 500), true)
    }
  }
}

type ScriptStatement = { sql: string; line: number; bytesRead: number }

/** Incremental lexer for common MySQL/PostgreSQL scripts; avoids split(';'). */
async function* streamStatements(
  path: string,
  engine: DbEngine,
  cancelled: () => boolean,
): AsyncGenerator<ScriptStatement> {
  const stream = createReadStream(path, { encoding: 'utf8', highWaterMark: 256 * 1024 })
  let parts: string[] = []
  let chars = 0
  let line = 1
  let startLine = 1
  let hasSql = false
  let state: 'normal' | 'single' | 'double' | 'backtick' | 'line-comment' | 'block-comment' | 'dollar' = 'normal'
  let dollarTag = ''
  let delimiter = ';'
  let atLineStart = true

  const push = (text: string) => {
    parts.push(text)
    chars += text.length
    if (chars > MAX_STATEMENT_CHARS) throw new Error('A single SQL statement exceeds the 16 MB safety limit')
  }
  const reset = () => { parts = []; chars = 0; hasSql = false; startLine = line }
  const emit = (bytesRead: number): ScriptStatement | null => {
    const sql = parts.join('').trim()
    reset()
    return sql ? { sql, line: startLine, bytesRead } : null
  }

  for await (const chunk of stream) {
    for (let i = 0; i < chunk.length; i += 1) {
      if (cancelled()) return
      const ch = chunk[i]
      const next = chunk[i + 1] || ''

      if (state === 'line-comment') {
        push(ch)
        if (ch === '\n') { state = 'normal'; line += 1; atLineStart = true } else atLineStart = false
        continue
      }
      if (state === 'block-comment') {
        push(ch)
        if (ch === '*' && next === '/') { push(next); i += 1; state = 'normal' }
        if (ch === '\n') { line += 1; atLineStart = true } else atLineStart = false
        continue
      }
      if (state === 'single' || state === 'double' || state === 'backtick') {
        push(ch)
        const quote = state === 'single' ? "'" : state === 'double' ? '"' : '`'
        if (ch === quote && next === quote && state !== 'backtick') { push(next); i += 1 }
        else if (ch === quote && chunk[i - 1] !== '\\') state = 'normal'
        if (ch === '\n') { line += 1; atLineStart = true } else atLineStart = false
        continue
      }
      if (state === 'dollar') {
        if (chunk.startsWith(dollarTag, i)) { push(dollarTag); i += dollarTag.length - 1; state = 'normal' }
        else push(ch)
        if (ch === '\n') { line += 1; atLineStart = true } else atLineStart = false
        continue
      }

      // MySQL client directive. It is not sent to the server.
      if (engine === 'mysql' && atLineStart && !hasSql && chunk.slice(i).match(/^DELIMITER\s+/i)) {
        const end = chunk.indexOf('\n', i)
        if (end < 0) throw new Error('DELIMITER directive must fit on one line')
        delimiter = chunk.slice(i, end).replace(/^DELIMITER\s+/i, '').trim() || ';'
        i = end
        line += 1
        atLineStart = true
        continue
      }
      if (!hasSql && !/\s/.test(ch)) { hasSql = true; startLine = line }
      if (ch === '-' && next === '-' && /\s/.test(chunk[i + 2] || ' ')) { push('--'); i += 1; state = 'line-comment'; atLineStart = false; continue }
      if (ch === '/' && next === '*') { push('/*'); i += 1; state = 'block-comment'; atLineStart = false; continue }
      if (ch === "'") { push(ch); state = 'single'; atLineStart = false; continue }
      if (ch === '"') { push(ch); state = 'double'; atLineStart = false; continue }
      if (ch === '`') { push(ch); state = 'backtick'; atLineStart = false; continue }
      if (engine === 'postgres' && ch === '$') {
        const tagEnd = chunk.indexOf('$', i + 1)
        const tag = tagEnd > i ? chunk.slice(i, tagEnd + 1) : ''
        if (/^\$[A-Za-z_][A-Za-z0-9_]*\$$|^\$\$$/.test(tag)) { push(tag); i = tagEnd; dollarTag = tag; state = 'dollar'; atLineStart = false; continue }
      }
      if (delimiter && chunk.startsWith(delimiter, i)) {
        const statement = emit(stream.bytesRead)
        i += delimiter.length - 1
        if (statement) yield statement
        atLineStart = false
        continue
      }
      push(ch)
      if (ch === '\n') { line += 1; atLineStart = true } else if (!/\s/.test(ch)) atLineStart = false
    }
  }
  if (state === 'single' || state === 'double' || state === 'backtick' || state === 'block-comment' || state === 'dollar') {
    throw new Error('SQL script ends inside a quoted string or comment')
  }
  const statement = emit(stream.bytesRead)
  if (statement) yield statement
}
