import { BrowserWindow } from 'electron'
import { KnownHostsStore } from '../ssh/trust/knownHosts'
import type { SessionLogManager } from '../ssh/sessionLog'
import { SSHManager } from '../ssh/manager'
import { MonitorCollector } from '../ssh/monitor/monitor'
import { SettingsStore } from '../store/settingsStore'
import { CredentialStore } from '../store/credentialStore'
import { registerSshConnectHandlers, clearLatencyTimers } from './registerSshConnectHandlers'
import { registerSftpHandlers } from './registerSftpHandlers'
import { registerSftpTransferHandlers } from './registerSftpTransferHandlers'
import { registerMonitorHandlers } from './registerMonitorHandlers'
import { registerExecHandlers } from './registerExecHandlers'

export { clearLatencyTimers }

type MainWindowGetter = () => BrowserWindow | null

export function registerSshHandlers(
  getMainWindow: MainWindowGetter,
  sshManager: SSHManager,
  settingsStore: SettingsStore,
  monitorCollector: MonitorCollector,
  credentialStore: CredentialStore,
  knownHosts: KnownHostsStore,
  sessionLog?: SessionLogManager,
): void {
  registerSshConnectHandlers(getMainWindow, sshManager, settingsStore, credentialStore, knownHosts, sessionLog)
  registerSftpHandlers(sshManager)
  registerSftpTransferHandlers(getMainWindow, sshManager, settingsStore)
  registerMonitorHandlers(settingsStore, monitorCollector)
  registerExecHandlers(sshManager)
}
