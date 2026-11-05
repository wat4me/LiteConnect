export type SplitMode = 'none' | 'horizontal' | 'vertical'
export type SplitSide = 'left' | 'right' | 'top' | 'bottom'

export interface PwdState {
  pwd: string
  homePath: string
  previousPwd: string
  shellReportsPwd?: boolean
}

/**
 * Terminal CWD tracker port. Session / SFTP depend on this shape, not on
 * `useTerminalPwd` internals (follow-path seam).
 */
export type TerminalPwdTracker = {
  state: Record<string, PwdState>
  initSession(sessionId: string, homePath: string, initialPwd?: string): void
  handleCd(sessionId: string, rawCommand: string): Promise<string | null>
  waitForPendingCd(sessionId: string): Promise<void>
  getPwd(sessionId: string): string | null
  getHomePath(sessionId: string): string | null
  hasSession(sessionId: string): boolean
  removeSession(sessionId: string): void
  setPwd(sessionId: string, pwd: string): void
  reportPwd(sessionId: string, pwd: string): void
}
