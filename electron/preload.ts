import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('LiteConnect', {
  getAppBootstrap: () => ipcRenderer.invoke('app:getBootstrap'),
  getConnections: () => ipcRenderer.invoke('store:getConnections'),
  saveConnection: (conn: any) => ipcRenderer.invoke('store:saveConnection', conn),
  deleteConnection: (id: string) => ipcRenderer.invoke('store:deleteConnection', id),
  updateConnectionGroup: (id: string, groupId: string | undefined) => ipcRenderer.invoke('store:updateConnectionGroup', id, groupId),
  setConnectionPinned: (id: string, pinned: boolean) =>
    ipcRenderer.invoke('store:setConnectionPinned', id, pinned),
  reorderConnections: (orderedIds: string[]) => ipcRenderer.invoke('store:reorderConnections', orderedIds),
  openConnectionWindow: (connectionId: string) =>
    ipcRenderer.invoke('window:openConnection', connectionId),
  isEncryptionAvailable: () => ipcRenderer.invoke('store:isEncryptionAvailable'),
  getConnectionPassword: (id: string) => ipcRenderer.invoke('store:getConnectionPassword', id),
  getSavedCredentials: () => ipcRenderer.invoke('store:getSavedCredentials'),
  getSavedCredentialPassword: (id: string) => ipcRenderer.invoke('store:getSavedCredentialPassword', id),
  saveSavedCredential: (credential: any) => ipcRenderer.invoke('store:saveSavedCredential', credential),
  deleteSavedCredential: (id: string) => ipcRenderer.invoke('store:deleteSavedCredential', id),

  getGroups: () => ipcRenderer.invoke('store:getGroups'),
  saveGroup: (group: any) => ipcRenderer.invoke('store:saveGroup', group),
  deleteGroup: (id: string) => ipcRenderer.invoke('store:deleteGroup', id),
  reorderGroups: (ids: string[]) => ipcRenderer.invoke('store:reorderGroups', ids),
  setDefaultGroup: (id: string | null) => ipcRenderer.invoke('store:setDefaultGroup', id),

  getDownloadPath: () => ipcRenderer.invoke('settings:getDownloadPath'),
  getDefaultDownloadPath: () => ipcRenderer.invoke('settings:getDefaultDownloadPath'),
  getConfiguredDownloadPath: () => ipcRenderer.invoke('settings:getConfiguredDownloadPath'),
  setDownloadPath: (dirPath: string) => ipcRenderer.invoke('settings:setDownloadPath', dirPath),
  getAutoReconnectEnabled: () => ipcRenderer.invoke('settings:getAutoReconnectEnabled'),
  setAutoReconnectEnabled: (enabled: boolean) => ipcRenderer.invoke('settings:setAutoReconnectEnabled', enabled),
  getAutoReconnectMaxRetries: () => ipcRenderer.invoke('settings:getAutoReconnectMaxRetries'),
  setAutoReconnectMaxRetries: (n: number) => ipcRenderer.invoke('settings:setAutoReconnectMaxRetries', n),
  getX11AutoStartEnabled: () => ipcRenderer.invoke('settings:getX11AutoStartEnabled'),
  setX11AutoStartEnabled: (enabled: boolean) => ipcRenderer.invoke('settings:setX11AutoStartEnabled', enabled),
  getX11ServerPath: () => ipcRenderer.invoke('settings:getX11ServerPath'),
  setX11ServerPath: (path: string) => ipcRenderer.invoke('settings:setX11ServerPath', path),
  getX11ServerStatus: (draftExecutablePath?: string) =>
    ipcRenderer.invoke('settings:getX11ServerStatus', draftExecutablePath),
  testX11Server: (opts?: { executablePath?: string; host?: string; display?: number }) =>
    ipcRenderer.invoke('settings:testX11Server', opts),
  killResidualX11Process: (opts?: { pid?: number; port?: number }) =>
    ipcRenderer.invoke('settings:killResidualX11Process', opts),
  getBundledX11InstallerStatus: () => ipcRenderer.invoke('settings:getBundledX11InstallerStatus'),
  installBundledX11Server: () => ipcRenderer.invoke('settings:installBundledX11Server'),
  selectX11ServerExecutable: () => ipcRenderer.invoke('settings:selectX11ServerExecutable'),

  getRecentConnections: () => ipcRenderer.invoke('settings:getRecentConnections'),
  recordRecentConnection: (connectionId: string) => ipcRenderer.invoke('settings:recordRecentConnection', connectionId),
  selectDirectory: () => ipcRenderer.invoke('settings:selectDirectory'),
  isLocalDirectory: (dirPath: string) => ipcRenderer.invoke('fs:isLocalDirectory', dirPath),

  getTerminalFontSize: () => ipcRenderer.invoke('settings:getTerminalFontSize'),
  setTerminalFontSize: (size: number) => ipcRenderer.invoke('settings:setTerminalFontSize', size),
  getTerminalFontFamily: () => ipcRenderer.invoke('settings:getTerminalFontFamily'),
  setTerminalFontFamily: (family: string) => ipcRenderer.invoke('settings:setTerminalFontFamily', family),
  getDbFontFamily: () => ipcRenderer.invoke('settings:getDbFontFamily'),
  setDbFontFamily: (family: string) => ipcRenderer.invoke('settings:setDbFontFamily', family),
  getDbFontSize: () => ipcRenderer.invoke('settings:getDbFontSize'),
  setDbFontSize: (size: number) => ipcRenderer.invoke('settings:setDbFontSize', size),
  getDbPageSize: () => ipcRenderer.invoke('settings:getDbPageSize'),
  setDbPageSize: (size: number) => ipcRenderer.invoke('settings:setDbPageSize', size),
  getDbConfirmDangerousSql: () => ipcRenderer.invoke('settings:getDbConfirmDangerousSql'),
  setDbConfirmDangerousSql: (enabled: boolean) =>
    ipcRenderer.invoke('settings:setDbConfirmDangerousSql', enabled),
  getDbDefaultMaxRows: () => ipcRenderer.invoke('settings:getDbDefaultMaxRows'),
  setDbDefaultMaxRows: (n: number) => ipcRenderer.invoke('settings:setDbDefaultMaxRows', n),
  getDbDefaultQueryTimeoutSec: () => ipcRenderer.invoke('settings:getDbDefaultQueryTimeoutSec'),
  setDbDefaultQueryTimeoutSec: (sec: number) =>
    ipcRenderer.invoke('settings:setDbDefaultQueryTimeoutSec', sec),
  getDbDefaultRunScope: () => ipcRenderer.invoke('settings:getDbDefaultRunScope'),
  setDbDefaultRunScope: (scope: string) => ipcRenderer.invoke('settings:setDbDefaultRunScope', scope),
  getTerminalPalette: () => ipcRenderer.invoke('settings:getTerminalPalette'),
  setTerminalPalette: (palette: string) => ipcRenderer.invoke('settings:setTerminalPalette', palette),
  getTerminalScrollback: () => ipcRenderer.invoke('settings:getTerminalScrollback'),
  setTerminalScrollback: (n: number) => ipcRenderer.invoke('settings:setTerminalScrollback', n),
  getTerminalPasteConfirmEnabled: () => ipcRenderer.invoke('settings:getTerminalPasteConfirmEnabled'),
  setTerminalPasteConfirmEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('settings:setTerminalPasteConfirmEnabled', enabled),
  getTerminalPasteConfirmMaxChars: () => ipcRenderer.invoke('settings:getTerminalPasteConfirmMaxChars'),
  setTerminalPasteConfirmMaxChars: (n: number) =>
    ipcRenderer.invoke('settings:setTerminalPasteConfirmMaxChars', n),
  getTerminalCommandSuggestEnabled: () => ipcRenderer.invoke('settings:getTerminalCommandSuggestEnabled'),
  setTerminalCommandSuggestEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('settings:setTerminalCommandSuggestEnabled', enabled),
  getDownloadConflictStrategy: () => ipcRenderer.invoke('settings:getDownloadConflictStrategy'),
  setDownloadConflictStrategy: (strategy: 'overwrite' | 'skip' | 'rename') =>
    ipcRenderer.invoke('settings:setDownloadConflictStrategy', strategy),
  getDirTransferConcurrency: () => ipcRenderer.invoke('settings:getDirTransferConcurrency'),
  setDirTransferConcurrency: (n: number) => ipcRenderer.invoke('settings:setDirTransferConcurrency', n),
  getDirTransferFailPolicy: () => ipcRenderer.invoke('settings:getDirTransferFailPolicy'),
  setDirTransferFailPolicy: (policy: 'continue' | 'stop') =>
    ipcRenderer.invoke('settings:setDirTransferFailPolicy', policy),
  getCommandSnippets: () => ipcRenderer.invoke('settings:getCommandSnippets'),
  setCommandSnippets: (snippets: any) => ipcRenderer.invoke('settings:setCommandSnippets', snippets),
  exportCommandSnippets: () => ipcRenderer.invoke('settings:exportCommandSnippets'),
  importCommandSnippets: (mode?: 'append' | 'replace') =>
    ipcRenderer.invoke('settings:importCommandSnippets', mode ?? 'append'),
  listShellCommandHistory: (connectionId: string) =>
    ipcRenderer.invoke('shellHistory:list', connectionId),
  pushShellCommandHistory: (connectionId: string, command: string) =>
    ipcRenderer.invoke('shellHistory:push', connectionId, command),
  clearShellCommandHistory: (connectionId?: string) =>
    ipcRenderer.invoke('shellHistory:clear', connectionId),
  getRecentDownloadPaths: () => ipcRenderer.invoke('settings:getRecentDownloadPaths'),
  addRecentDownloadPath: (dirPath: string) => ipcRenderer.invoke('settings:addRecentDownloadPath', dirPath),
  getCredentialAutoFillEnabled: () => ipcRenderer.invoke('settings:getCredentialAutoFillEnabled'),
  setCredentialAutoFillEnabled: (enabled: boolean) => ipcRenderer.invoke('settings:setCredentialAutoFillEnabled', enabled),
  getAiSettings: () => ipcRenderer.invoke('settings:getAiSettings'),
  setAiSettings: (settings: any) => ipcRenderer.invoke('settings:setAiSettings', settings),
  switchAiModel: (providerId: string, model: string) => ipcRenderer.invoke('settings:switchAiModel', providerId, model),
  testAiProvider: (provider: { baseUrl: string; apiKey: string; model: string }) => ipcRenderer.invoke('ai:testProvider', provider),
  aiChat: (messages: any[]) => ipcRenderer.invoke('ai:chat', messages),
  aiChatStream: (requestId: string, messages: any[]) => ipcRenderer.invoke('ai:chatStream', requestId, messages),
  aiAbortChatStream: (requestId: string) => ipcRenderer.invoke('ai:abortChatStream', requestId),
  aiGenerateConversationTitle: (payload: {
    userText: string
    assistantText?: string
    sessionId?: string
    threadId?: string
  }) => ipcRenderer.invoke('ai:generateConversationTitle', payload),
  getAiSessionHistory: (sessionId: string) => ipcRenderer.invoke('ai:getSessionHistory', sessionId),
  getAiSessionStore: (sessionId: string) => ipcRenderer.invoke('ai:getSessionStore', sessionId),
  setAiSessionStore: (sessionId: string, store: any) => ipcRenderer.invoke('ai:setSessionStore', sessionId, store),
  aiSetThreadTitle: (sessionId: string, threadId: string, title: string) =>
    ipcRenderer.invoke('ai:setThreadTitle', sessionId, threadId, title),
  aiCreateConversation: (
    sessionId: string,
    payload: {
      threadId?: string
      messages?: any[]
      title?: string
      titleGenerated?: boolean
    },
  ) => ipcRenderer.invoke('ai:createConversation', sessionId, payload),
  appendAiSessionHistory: (sessionId: string, record: any) => ipcRenderer.invoke('ai:appendSessionHistory', sessionId, record),
  clearAiSessionHistory: (sessionId: string) => ipcRenderer.invoke('ai:clearSessionHistory', sessionId),
  onAiChatStream: (requestId: string, callback: (payload: any) => void) => {
    const channel = `ai:chatStream:${requestId}`
    const listener = (_event: any, payload: any) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  getLatencyEnabled: () => ipcRenderer.invoke('settings:getLatencyEnabled'),
  setLatencyEnabled: (enabled: boolean) => ipcRenderer.invoke('settings:setLatencyEnabled', enabled),
  getLatencyIntervalMs: () => ipcRenderer.invoke('settings:getLatencyIntervalMs'),
  setLatencyIntervalMs: (intervalMs: number) => ipcRenderer.invoke('settings:setLatencyIntervalMs', intervalMs),

  exportConnections: () => ipcRenderer.invoke('store:exportConnections'),
  importConnections: () => ipcRenderer.invoke('store:importConnections'),

  sshConnect: (connectionId: string) => ipcRenderer.invoke('ssh:connect', connectionId),
  /** Reuse sessionId: tear down old transport and open a new shell in place */
  sshReconnect: (sessionId: string, connectionId: string) =>
    ipcRenderer.invoke('ssh:reconnect', sessionId, connectionId),
  sshTakeStartupNotices: (sessionId: string) => ipcRenderer.invoke('ssh:takeStartupNotices', sessionId),
  sshDisconnect: (sessionId: string) => ipcRenderer.invoke('ssh:disconnect', sessionId),
  sshWrite: (sessionId: string, data: string) => ipcRenderer.send('ssh:write', sessionId, data),
  sshResize: (sessionId: string, cols: number, rows: number) => ipcRenderer.send('ssh:resize', sessionId, cols, rows),
  sshTestConnection: (connectionId: string) => ipcRenderer.invoke('ssh:testConnection', connectionId),
  sshTestConnectionParams: (params: {
    host: string
    port: number
    username: string
    password?: string
    privateKey?: string
    connectionId?: string
    savedCredentialId?: string
    jumpHost?: string
    jumpPort?: number
    jumpUsername?: string
    jumpPassword?: string
    jumpPrivateKey?: string
    useAgent?: boolean
  }) => ipcRenderer.invoke('ssh:testConnectionParams', params),
  sshDiagnoseConnectionParams: (params: {
    host: string
    port: number
    username: string
    password?: string
    privateKey?: string
    connectionId?: string
    savedCredentialId?: string
    jumpHost?: string
    jumpPort?: number
    jumpUsername?: string
    jumpPassword?: string
    jumpPrivateKey?: string
    useAgent?: boolean
  }) => ipcRenderer.invoke('ssh:diagnoseConnectionParams', params),

  sshRemoveHostKey: (host: string, port: number) => ipcRenderer.invoke('ssh:removeHostKey', host, port),
  sshUpdateHostKey: (host: string, port: number, keyBuffer: Buffer) => ipcRenderer.invoke('ssh:updateHostKey', host, port, keyBuffer),
  /** Trust host key from test/diagnose result (public key base64). */
  sshTrustHostKey: (host: string, port: number, keyBase64: string) =>
    ipcRenderer.invoke('ssh:trustHostKey', host, port, keyBase64),
  sshGetHostKeyFingerprint: (host: string, port: number) => ipcRenderer.invoke('ssh:getHostKeyFingerprint', host, port),
  sshConfirmHostKey: (connectionId: string) => ipcRenderer.invoke('ssh:confirmHostKey', connectionId),
  sshRejectHostKey: (connectionId: string) => ipcRenderer.invoke('ssh:rejectHostKey', connectionId),
  onSshHostKeyMismatch: (callback: (data: {
    connectionId: string
    host: string
    port: number
    existingFingerprint: string
    newFingerprint: string
    role?: 'target' | 'jump'
  }) => void) => {
    const listener = (_event: any, data: {
      connectionId: string
      host: string
      port: number
      existingFingerprint: string
      newFingerprint: string
      role?: 'target' | 'jump'
    }) => callback(data)
    ipcRenderer.on('ssh:hostKeyMismatch', listener)
    return () => ipcRenderer.removeListener('ssh:hostKeyMismatch', listener)
  },
  onSshDecryptionFailed: (callback: (data: { connectionId: string; field: 'password' | 'privateKey' | 'apiKey'; message: string }) => void) => {
    const listener = (_event: any, data: { connectionId: string; field: 'password' | 'privateKey' | 'apiKey'; message: string }) => callback(data)
    ipcRenderer.on('ssh:decryptionFailed', listener)
    return () => ipcRenderer.removeListener('ssh:decryptionFailed', listener)
  },

  sshStartLatencyMonitor: (sessionId: string) => ipcRenderer.invoke('ssh:startLatencyMonitor', sessionId),
  sshStopLatencyMonitor: (sessionId: string) => ipcRenderer.invoke('ssh:stopLatencyMonitor', sessionId),
  sshMeasureLatency: (sessionId: string) => ipcRenderer.invoke('ssh:measureLatency', sessionId),
  sshExec: (sessionId: string, command: string, timeoutMs?: number) => ipcRenderer.invoke('ssh:exec', sessionId, command, timeoutMs),

  /** Docker availability probe for an SSH session (sessionId only; no socket/path/API). */
  dockerProbe: (sessionId: string) => ipcRenderer.invoke('docker:probe', sessionId),
  /** List containers (sessionId only; main constructs Docker API path). */
  dockerListContainers: (sessionId: string) =>
    ipcRenderer.invoke('docker:list-containers', sessionId),
  /** Inspect one container (sessionId + validated containerId only). */
  dockerInspectContainer: (sessionId: string, containerId: string) =>
    ipcRenderer.invoke('docker:inspect-container', sessionId, containerId),
  /**
   * Container lifecycle action (start | stop | restart only).
   * Main constructs method/path/query/timeout; no free-form Docker API.
   */
  dockerContainerAction: (
    sessionId: string,
    containerId: string,
    action: 'start' | 'stop' | 'restart',
  ) => ipcRenderer.invoke('docker:container-action', sessionId, containerId, action),
  /**
   * Start container log stream (sessionId + containerId + {tail, follow, requestId} only).
   * requestId must be 32 hex; events carry requestId for pre-resolve handshake.
   */
  dockerStartContainerLogs: (
    sessionId: string,
    containerId: string,
    options: { tail: 100 | 200 | 500 | 1000; follow: boolean; requestId: string },
  ) => ipcRenderer.invoke('docker:start-container-logs', sessionId, containerId, options),
  /** Stop log stream by main-issued streamId (owner-checked). Idempotent. */
  dockerStopContainerLogs: (streamId: string) =>
    ipcRenderer.invoke('docker:stop-container-logs', streamId),
  onDockerContainerLogData: (
    callback: (payload: {
      streamId: string
      requestId: string
      entries: Array<{
        sequence: number
        stream: 'stdout' | 'stderr'
        timestamp: string | null
        text: string
      }>
      droppedFromMain: number
    }) => void,
  ) => {
    const channel = 'docker:container-log-data'
    const listener = (
      _event: unknown,
      payload: {
        streamId: string
        requestId: string
        entries: Array<{
          sequence: number
          stream: 'stdout' | 'stderr'
          timestamp: string | null
          text: string
        }>
        droppedFromMain: number
      },
    ) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onDockerContainerLogState: (
    callback: (payload: {
      streamId: string
      requestId: string
      state: 'connecting' | 'streaming' | 'ended' | 'disconnected' | 'error'
      code?: string
    }) => void,
  ) => {
    const channel = 'docker:container-log-state'
    const listener = (
      _event: unknown,
      payload: {
        streamId: string
        requestId: string
        state: 'connecting' | 'streaming' | 'ended' | 'disconnected' | 'error'
        code?: string
      },
    ) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  /**
   * Start container interactive exec (shell enum + size + requestId only).
   * Main maps shell to fixed /bin/bash or /bin/sh; no arbitrary Cmd.
   */
  dockerStartContainerExec: (
    sessionId: string,
    containerId: string,
    options: {
      shell: 'bash' | 'sh'
      requestId: string
      cols: number
      rows: number
    },
  ) => ipcRenderer.invoke('docker:start-container-exec', sessionId, containerId, options),
  dockerWriteContainerExec: (terminalId: string, data: string) =>
    ipcRenderer.invoke('docker:write-container-exec', terminalId, data),
  dockerResizeContainerExec: (terminalId: string, cols: number, rows: number) =>
    ipcRenderer.invoke('docker:resize-container-exec', terminalId, cols, rows),
  dockerStopContainerExec: (terminalId: string) =>
    ipcRenderer.invoke('docker:stop-container-exec', terminalId),
  onDockerContainerExecData: (
    callback: (payload: {
      requestId: string
      terminalId: string
      sequence: number
      data: ArrayBuffer
    }) => void,
  ) => {
    const channel = 'docker:container-exec-data'
    const listener = (
      _event: unknown,
      payload: {
        requestId: string
        terminalId: string
        sequence: number
        data: ArrayBuffer
      },
    ) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onDockerContainerExecState: (
    callback: (payload: {
      requestId: string
      terminalId: string | null
      state: 'connecting' | 'attached' | 'ended' | 'disconnected' | 'error'
      code?: string
      exitCode?: number | null
    }) => void,
  ) => {
    const channel = 'docker:container-exec-state'
    const listener = (
      _event: unknown,
      payload: {
        requestId: string
        terminalId: string | null
        state: 'connecting' | 'attached' | 'ended' | 'disconnected' | 'error'
        code?: string
        exitCode?: number | null
      },
    ) => callback(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  getMonitorEnabled: () => ipcRenderer.invoke('settings:getMonitorEnabled'),
  setMonitorEnabled: (enabled: boolean) => ipcRenderer.invoke('settings:setMonitorEnabled', enabled),
  getMonitorIntervalMs: () => ipcRenderer.invoke('settings:getMonitorIntervalMs'),
  setMonitorIntervalMs: (intervalMs: number) => ipcRenderer.invoke('settings:setMonitorIntervalMs', intervalMs),
  monitorStart: (sessionId: string) => ipcRenderer.invoke('monitor:start', sessionId),
  monitorStop: (sessionId: string) => ipcRenderer.invoke('monitor:stop', sessionId),

  sftpInit: (sessionId: string) => ipcRenderer.invoke('sftp:init', sessionId),
  sftpReaddir: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp:readdir', sessionId, remotePath),
  sftpRealpath: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp:realpath', sessionId, remotePath),
  sftpExecHome: (sessionId: string) => ipcRenderer.invoke('sftp:execHome', sessionId),
  sftpDownload: (
    sessionId: string,
    remotePath: string,
    fileName: string,
    transferId: string,
    options?: {
      conflict?: 'overwrite' | 'skip' | 'rename'
      resume?: boolean
      localDir?: string
      localPath?: string
    },
  ) => ipcRenderer.send('sftp:download', sessionId, remotePath, fileName, transferId, options),
  sftpUpload: (
    sessionId: string,
    localPath: string,
    remotePath: string,
    fileName: string,
    transferId: string,
    options?: {
      conflict?: 'overwrite' | 'skip' | 'rename'
      resume?: boolean
      remoteFullPath?: string
    },
  ) => ipcRenderer.send('sftp:upload', sessionId, localPath, remotePath, fileName, transferId, options),
  sftpCancelTransfer: (transferId: string) => ipcRenderer.send('sftp:cancelTransfer', transferId),
  sftpExtractArchive: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('sftp:extractArchive', sessionId, remotePath),
  sftpExists: (sessionId: string, remotePath: string) =>
    ipcRenderer.invoke('sftp:exists', sessionId, remotePath),
  sftpReadFile: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp:readFile', sessionId, remotePath),
  sftpWriteFile: (sessionId: string, remotePath: string, content: string) => ipcRenderer.invoke('sftp:writeFile', sessionId, remotePath, content),
  sftpChmod: (sessionId: string, remotePath: string, mode: string, recursive?: boolean) => ipcRenderer.invoke('sftp:chmod', sessionId, remotePath, mode, recursive),
  sftpChown: (sessionId: string, remotePath: string, owner: string, group?: string, recursive?: boolean) => ipcRenderer.invoke('sftp:chown', sessionId, remotePath, owner, group, recursive),
  sftpRename: (sessionId: string, oldPath: string, newPath: string) => ipcRenderer.invoke('sftp:rename', sessionId, oldPath, newPath),
  sftpMkdir: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp:mkdir', sessionId, remotePath),
  sftpDelete: (sessionId: string, remotePath: string, isDirectory?: boolean) => ipcRenderer.invoke('sftp:delete', sessionId, remotePath, isDirectory),
  sftpDownloadDirectory: (
    sessionId: string,
    remotePath: string,
    dirName: string,
    transferId: string,
    options?: { concurrency?: number; failPolicy?: 'continue' | 'stop' },
  ) => ipcRenderer.send('sftp:downloadDirectory', sessionId, remotePath, dirName, transferId, options),
  sftpUploadDirectory: (
    sessionId: string,
    localPath: string,
    remoteParent: string,
    dirName: string,
    transferId: string,
    options?: {
      conflict?: 'overwrite' | 'skip' | 'rename'
      concurrency?: number
      failPolicy?: 'continue' | 'stop'
    },
  ) => ipcRenderer.send('sftp:uploadDirectory', sessionId, localPath, remoteParent, dirName, transferId, options),
  sftpStat: (sessionId: string, remotePath: string) => ipcRenderer.invoke('sftp:stat', sessionId, remotePath),

  getPathForFile: (file: File) => webUtils.getPathForFile(file),

  readPrivateKeyFile: () => ipcRenderer.invoke('dialog:readPrivateKey'),

  shellOpenPath: (filePath: string) => ipcRenderer.invoke('shell:openPath', filePath),
  shellShowItemInFolder: (filePath: string) => ipcRenderer.invoke('shell:showItemInFolder', filePath),
  openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),

  clipboardReadText: () => ipcRenderer.invoke('clipboard:readText'),
  clipboardWriteText: (text: string) => ipcRenderer.invoke('clipboard:writeText', text),

  onSshData: (sessionId: string, callback: (data: string) => void) => {
    const channel = `ssh:data:${sessionId}`
    const listener = (_event: any, data: string) => callback(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onSshClosed: (sessionId: string, callback: () => void) => {
    const channel = `ssh:closed:${sessionId}`
    const listener = () => callback()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onSshReconnected: (sessionId: string, callback: () => void) => {
    const channel = `ssh:reconnected:${sessionId}`
    const listener = () => callback()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onSshError: (sessionId: string, callback: (error: string) => void) => {
    const channel = `ssh:error:${sessionId}`
    const listener = (_event: any, error: string) => callback(error)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  onSshLatency: (sessionId: string, callback: (latencyMs: number) => void) => {
    const channel = `ssh:latency:${sessionId}`
    const listener = (_event: any, latencyMs: number) => callback(latencyMs)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  onMonitorData: (sessionId: string, callback: (data: any) => void) => {
    const channel = `monitor:data:${sessionId}`
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  onTransferStart: (
    callback: (
      sessionId: string,
      transferId: string,
      fileName: string,
      localPath: string,
      direction: 'download' | 'upload',
      remotePath?: string,
    ) => void,
  ) => {
    const listener = (
      _event: any,
      sessionId: string,
      transferId: string,
      fileName: string,
      localPath: string,
      direction: string,
      remotePath?: string,
    ) => callback(sessionId, transferId, fileName, localPath, direction as 'download' | 'upload', remotePath)
    ipcRenderer.on('sftp:transferStart', listener)
    return () => ipcRenderer.removeListener('sftp:transferStart', listener)
  },
  onTransferProgress: (
    callback: (
      sessionId: string,
      transferId: string,
      transferred: number,
      total: number,
      stats?: { completedFiles: number; failedFiles: number; totalFiles: number },
    ) => void,
  ) => {
    const listener = (
      _event: any,
      sessionId: string,
      transferId: string,
      transferred: number,
      total: number,
      stats?: { completedFiles: number; failedFiles: number; totalFiles: number },
    ) => callback(sessionId, transferId, transferred, total, stats)
    ipcRenderer.on('sftp:transferProgress', listener)
    return () => ipcRenderer.removeListener('sftp:transferProgress', listener)
  },
  onTransferComplete: (
    callback: (
      sessionId: string,
      transferId: string,
      localPath: string,
      status?: 'skipped' | 'partial',
      stats?: { completedFiles: number; failedFiles: number; totalFiles: number },
    ) => void,
  ) => {
    const listener = (
      _event: any,
      sessionId: string,
      transferId: string,
      localPath: string,
      status?: 'skipped' | 'partial',
      stats?: { completedFiles: number; failedFiles: number; totalFiles: number },
    ) => callback(sessionId, transferId, localPath, status, stats)
    ipcRenderer.on('sftp:transferComplete', listener)
    return () => ipcRenderer.removeListener('sftp:transferComplete', listener)
  },
  onTransferError: (callback: (sessionId: string, transferId: string, error: string) => void) => {
    const listener = (_event: any, sessionId: string, transferId: string, error: string) => callback(sessionId, transferId, error)
    ipcRenderer.on('sftp:transferError', listener)
    return () => ipcRenderer.removeListener('sftp:transferError', listener)
  },

  updateTitleBar: (theme: string, colors?: { color: string; symbolColor: string }) => ipcRenderer.send('titlebar:theme', theme, colors),

  // Database (MySQL / PostgreSQL; optional SSH tunnel)
  dbListConnections: () => ipcRenderer.invoke('db:listConnections'),
  dbListGroups: () => ipcRenderer.invoke('db:listGroups'),
  dbGetConnectionPassword: (id: string) => ipcRenderer.invoke('db:getConnectionPassword', id),
  dbSaveConnection: (conn: any) => ipcRenderer.invoke('db:saveConnection', conn),
  dbDeleteConnection: (id: string) => ipcRenderer.invoke('db:deleteConnection', id),
  dbReorderConnections: (orderedIds: string[]) =>
    ipcRenderer.invoke('db:reorderConnections', orderedIds),
  dbExportConnections: (includePassword?: boolean) =>
    ipcRenderer.invoke('db:exportConnections', includePassword),
  dbImportConnections: () => ipcRenderer.invoke('db:importConnections'),
  dbListSshConnections: () => ipcRenderer.invoke('db:listSshConnections'),
  dbTestConnection: (params: any) => ipcRenderer.invoke('db:testConnection', params),
  dbConnect: (connectionId: string) => ipcRenderer.invoke('db:connect', connectionId),
  dbDisconnect: (sessionId: string) => ipcRenderer.invoke('db:disconnect', sessionId),
  dbDisconnectByConnectionId: (connectionId: string) =>
    ipcRenderer.invoke('db:disconnectByConnectionId', connectionId),
  dbTakePendingSessionLost: (connectionId: string, sessionId?: string) =>
    ipcRenderer.invoke('db:takePendingSessionLost', connectionId, sessionId),
  onDbSessionLost: (
    callback: (data: {
      sessionId: string
      connectionId: string
      reason: string
      detail?: string
      message?: string
    }) => void,
  ) => {
    const listener = (
      _event: any,
      data: {
        sessionId: string
        connectionId: string
        reason: string
        detail?: string
        message?: string
      },
    ) => callback(data)
    ipcRenderer.on('db:sessionLost', listener)
    return () => ipcRenderer.removeListener('db:sessionLost', listener)
  },
  dbGetSession: (sessionId: string) => ipcRenderer.invoke('db:getSession', sessionId),
  dbListDatabases: (sessionId: string) => ipcRenderer.invoke('db:listDatabases', sessionId),
  dbListTables: (sessionId: string, database?: string) => ipcRenderer.invoke('db:listTables', sessionId, database),
  dbListTableInfos: (sessionId: string, database?: string) => ipcRenderer.invoke('db:listTableInfos', sessionId, database),
  dbGetTableColumns: (sessionId: string, database: string, table: string) =>
    ipcRenderer.invoke('db:getTableColumns', sessionId, database, table),
  dbGetTableIndexes: (sessionId: string, database: string, table: string) =>
    ipcRenderer.invoke('db:getTableIndexes', sessionId, database, table),
  dbGetCreateTable: (sessionId: string, database: string, table: string) =>
    ipcRenderer.invoke('db:getCreateTable', sessionId, database, table),
  dbBrowseTable: (
    sessionId: string,
    database: string,
    table: string,
    page?: number,
    pageSize?: number,
    options?: {
      orderBy?: string
      orderDir?: 'asc' | 'desc'
      /** Custom WHERE predicate (no leading WHERE) */
      where?: string
      filters?: Array<{ column: string; op: string; value?: string }>
    },
  ) => ipcRenderer.invoke('db:browseTable', sessionId, database, table, page, pageSize, options),
  dbUseDatabase: (sessionId: string, database: string) => ipcRenderer.invoke('db:useDatabase', sessionId, database),
  dbCreateDatabase: (
    sessionId: string,
    name: string,
    options?: { charset?: string; collate?: string; encoding?: string; template?: string },
  ) => ipcRenderer.invoke('db:createDatabase', sessionId, name, options),
  dbQuery: (
    sessionId: string,
    sql: string,
    options?: {
      maxRows?: number
      timeoutMs?: number
      queryId?: string
      database?: string
      clientKey?: string
      readOnly?: boolean
    },
  ) => ipcRenderer.invoke('db:query', sessionId, sql, options),
  dbCancelQuery: (sessionId: string, queryId: string) =>
    ipcRenderer.invoke('db:cancelQuery', sessionId, queryId),
  dbSelectSqlScript: () => ipcRenderer.invoke('db:selectSqlScript'),
  dbRunSqlScript: (sessionId: string, token: string, database?: string) =>
    ipcRenderer.invoke('db:runSqlScript', sessionId, token, database),
  dbCancelSqlScript: (jobId: string) => ipcRenderer.invoke('db:cancelSqlScript', jobId),
  onDbScriptProgress: (callback: (data: any) => void) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('db:scriptProgress', listener)
    return () => ipcRenderer.removeListener('db:scriptProgress', listener)
  },
  dbExplain: (sessionId: string, sql: string, database?: string) =>
    ipcRenderer.invoke('db:explain', sessionId, sql, database),
  dbBeginTransaction: (sessionId: string, clientKey: string, database?: string) =>
    ipcRenderer.invoke('db:beginTransaction', sessionId, clientKey, database),
  dbCommitTransaction: (sessionId: string, clientKey: string) =>
    ipcRenderer.invoke('db:commitTransaction', sessionId, clientKey),
  dbRollbackTransaction: (sessionId: string, clientKey: string) =>
    ipcRenderer.invoke('db:rollbackTransaction', sessionId, clientKey),
  dbGetTransactionState: (sessionId: string, clientKey: string) =>
    ipcRenderer.invoke('db:getTransactionState', sessionId, clientKey),
  dbReleaseClient: (sessionId: string, clientKey: string) =>
    ipcRenderer.invoke('db:releaseClient', sessionId, clientKey),
  dbAssessSqlRisk: (sql: string) => ipcRenderer.invoke('db:assessSqlRisk', sql),
  dbExportTable: (input: {
    sessionId: string
    database: string
    table: string
    format?: 'csv' | 'jsonl'
    options?: {
      orderBy?: string
      orderDir?: 'asc' | 'desc'
      where?: string
      filters?: Array<{ column: string; op: string; value?: string }>
    }
    maxRows?: number
    defaultFileName?: string
  }) => ipcRenderer.invoke('db:exportTable', input),
  dbCancelExport: (exportId: string) => ipcRenderer.invoke('db:cancelExport', exportId),
  onDbExportProgress: (
    callback: (data: {
      exportId: string
      rowsWritten: number
      bytesWritten: number
      phase: string
      error?: string
      filePath?: string
    }) => void,
  ) => {
    const listener = (_event: any, data: any) => callback(data)
    ipcRenderer.on('db:exportProgress', listener)
    return () => ipcRenderer.removeListener('db:exportProgress', listener)
  },
  dbListQueryHistory: (connectionId?: string) =>
    ipcRenderer.invoke('db:listQueryHistory', connectionId),
  dbPushQueryHistory: (input: {
    sql: string
    database?: string
    connectionId?: string
    status?: 'success' | 'failed' | 'cancelled'
    durationMs?: number
    rowCount?: number
    affectedRows?: number
    errorSummary?: string
    slow?: boolean
    runScope?: 'selection' | 'statement' | 'all' | 'explain'
    truncated?: boolean
  }) => ipcRenderer.invoke('db:pushQueryHistory', input),
  dbClearQueryHistory: (connectionId?: string) =>
    ipcRenderer.invoke('db:clearQueryHistory', connectionId),
  dbMergeQueryHistoryLegacy: (items: unknown[]) =>
    ipcRenderer.invoke('db:mergeQueryHistoryLegacy', items),

  // Auto-updater
  checkForUpdates: () => ipcRenderer.invoke('updater:check'),
  downloadUpdate: () => ipcRenderer.invoke('updater:download'),
  quitAndInstall: () => ipcRenderer.invoke('updater:install'),
  skipUpdateVersion: (version: string) => ipcRenderer.invoke('updater:skipVersion', version),
  getAutoUpdateEnabled: () => ipcRenderer.invoke('settings:getAutoUpdateEnabled'),
  setAutoUpdateEnabled: (enabled: boolean) => ipcRenderer.invoke('settings:setAutoUpdateEnabled', enabled),
  onUpdateStatus: (callback: (status: any) => void) => {
    const listener = (_event: any, status: any) => callback(status)
    ipcRenderer.on('updater:status', listener)
    return () => ipcRenderer.removeListener('updater:status', listener)
  },
})
