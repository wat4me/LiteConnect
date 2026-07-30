export interface BatchCommandTarget {
  id: string
  connectionName: string
  sshAddress: string
  tabNumber: number
  terminalLabel: string
  displayName: string
  /** For per-session snippet variable expansion */
  host?: string
  user?: string
  port?: number
  connectionId?: string
}
