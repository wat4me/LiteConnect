// Compile-only checks: never executed. Unused @ts-expect-error fails the CI typecheck.
import type { SftpApi, SftpEventSender } from '../../shared/ipc/sftp'
import type { LiteConnectApi } from '../../src/types/liteConnectApi'
import { handleSftp, onSftp, sendSftpEvent } from '../../electron/ipc/sftpContract'
import type { WebContents } from 'electron'

export function checkSftpContract(api: SftpApi, renderer: LiteConnectApi, send: SftpEventSender, owner: WebContents) {
  const rendererApi: SftpApi = renderer
  const stat: ReturnType<SftpApi['sftpStat']> = rendererApi.sftpStat('session', '/path')
  void stat
  api.sftpDownload('session', '/remote', 'file', 'transfer', { conflict: 'rename', resume: true })
  api.sftpUpload('session', 'C:/file', '/remote', 'file', 'transfer', { conflict: 'ask', batchId: 'batch' })
  // @ts-expect-error downloads cannot request an upload conflict dialog
  api.sftpDownload('session', '/remote', 'file', 'transfer', { conflict: 'ask' })
  // @ts-expect-error a transfer id is required
  api.sftpUpload('session', 'C:/file', '/remote', 'file')
  // @ts-expect-error invoke return types must not decay to Promise<any>
  const wrongStat: Promise<string> = api.sftpStat('session', '/path')
  void wrongStat
  // @ts-expect-error invalid conflict decision
  api.resolveUploadConflict('request', { action: 'replace', applyToAll: true })
  // @ts-expect-error event callback payload is not an Electron event or a string
  api.onUploadConflict((request: string) => { void request })

  handleSftp('sftp:exists', async (_event, session, path) => Boolean(session && path))
  // @ts-expect-error wrong handler return type
  handleSftp('sftp:exists', async () => 'yes')
  // @ts-expect-error wrong handler parameter type
  handleSftp('sftp:readdir', async (_event, session: number) => { void session; return [] })
  // @ts-expect-error void responses must not silently accept data
  handleSftp('sftp:init', async () => 123)
  // @ts-expect-error send-only command cannot be registered as an invocation
  handleSftp('sftp:download', async () => {})
  onSftp('sftp:upload', (_event, session, local, remote, name, id, options) => {
    api.sftpUpload(session, local, remote, name, id, options)
  })
  // @ts-expect-error wrong conflict payload
  onSftp('sftp:resolveUploadConflict', (_event, _id, decision: string) => { void decision })
  // @ts-expect-error invoke channel cannot be registered as a command
  onSftp('sftp:stat', () => {})

  send('sftp:transferProgress', 'session', 'transfer', 10, 100)
  send('sftp:uploadConflict', null)
  // @ts-expect-error byte counts must be numeric
  send('sftp:transferProgress', 'session', 'transfer', '10', 100)
  // @ts-expect-error status belongs to completion events, not errors
  send('sftp:transferError', 'session', 'transfer', 'failed', 'partial')
  // @ts-expect-error incomplete conflict request
  send('sftp:uploadConflict', { requestId: 'request' })
  // @ts-expect-error main-process event sender uses the same event tuple
  sendSftpEvent(owner, 'sftp:transferStart', 'session', 'transfer', 'file', 'local', 'sideways')
}
