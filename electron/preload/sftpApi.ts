import type { IpcRenderer, IpcRendererEvent } from 'electron'
import type { SftpApi, SftpEventArgs, SftpInvokeContract, SftpSendContract } from '../../shared/ipc/sftp'

/** Electron's untyped transport is confined to this adapter. */
export function createSftpApi(ipc: Pick<IpcRenderer, 'invoke' | 'send' | 'on' | 'removeListener'>): SftpApi {
  function invoke<K extends keyof SftpInvokeContract>(channel: K) {
    return (...args: Parameters<SftpInvokeContract[K]>): ReturnType<SftpInvokeContract[K]> =>
      ipc.invoke(channel, ...args) as ReturnType<SftpInvokeContract[K]>
  }
  function send<K extends keyof SftpSendContract>(channel: K) {
    return (...args: Parameters<SftpSendContract[K]>): void => { ipc.send(channel, ...args) }
  }
  function subscribe<K extends keyof SftpEventArgs>(channel: K) {
    return (callback: (...args: SftpEventArgs[K]) => void) => {
      const listener = (_event: IpcRendererEvent, ...args: SftpEventArgs[K]) => callback(...args)
      ipc.on(channel, listener)
      return () => { ipc.removeListener(channel, listener) }
    }
  }
  return {
    sftpInit: invoke('sftp:init'),
    sftpReaddir: invoke('sftp:readdir'),
    sftpRealpath: invoke('sftp:realpath'),
    sftpExecHome: invoke('sftp:execHome'),
    sftpExtractArchive: invoke('sftp:extractArchive'),
    sftpExists: invoke('sftp:exists'),
    sftpEditorSnapshot: invoke('sftp:editorSnapshot'),
    sftpEditorSave: invoke('sftp:editorSave'),
    sftpDirectoryPreview: invoke('sftp:directoryPreview'),
    sftpReadFile: invoke('sftp:readFile'),
    sftpWriteFile: invoke('sftp:writeFile'),
    sftpChmod: invoke('sftp:chmod'),
    sftpChown: invoke('sftp:chown'),
    sftpRename: invoke('sftp:rename'),
    sftpMkdir: invoke('sftp:mkdir'),
    sftpDelete: invoke('sftp:delete'),
    sftpStat: invoke('sftp:stat'),
    sftpDownload: send('sftp:download'),
    sftpUpload: send('sftp:upload'),
    sftpDownloadDirectory: send('sftp:downloadDirectory'),
    sftpUploadDirectory: send('sftp:uploadDirectory'),
    sftpCancelTransfer: send('sftp:cancelTransfer'),
    resolveUploadConflict: send('sftp:resolveUploadConflict'),
    onUploadConflict: subscribe('sftp:uploadConflict'),
    onTransferStart: subscribe('sftp:transferStart'),
    onTransferProgress: subscribe('sftp:transferProgress'),
    onTransferComplete: subscribe('sftp:transferComplete'),
    onTransferError: subscribe('sftp:transferError'),
  } satisfies SftpApi
}
