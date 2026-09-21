export interface Session {
  id: string
  connectionId: string
  connectionName: string
  tabNumber: number
  /** Restored tab: no SSH yet; reconnect() will connect in-place */
  pending?: boolean
}

export interface ConnectionGroup {
  connectionId: string
  connectionName: string
  sessions: Session[]
  activeSessionId: string | null
  nextTabNumber: number
}

export type SplitDropPayload = {
  mode: 'horizontal' | 'vertical'
  side: 'left' | 'right' | 'top' | 'bottom'
  sessionId: string
  /** Explicit pane receiving the dragged session (for host-tab to host-tab drops). */
  primarySessionId?: string
}

export type SplitPreviewPayload = {
  mode: 'none' | 'horizontal' | 'vertical'
  side: 'left' | 'right' | 'top' | 'bottom' | null
  sessionId: string
  primarySessionId?: string
}

export type SplitSwapPayload = {
  primarySessionId: string
  secondarySessionId: string
}

export type SplitPaneSessionPayload = {
  side: 'primary' | 'secondary'
  sessionId: string
}

export type SplitPaneAddPayload = {
  side: 'primary' | 'secondary'
  connectionId: string
}
