export type SnippetSendMode = 'run' | 'fill'

export interface ShellCommandHistoryItem {
  command: string
  at: number
}

export interface CommandSnippet {
  id: string
  name: string
  command: string
  group?: string
  pinned?: boolean
  sortOrder?: number
  sendMode?: SnippetSendMode
  hotkey?: string
  useCount?: number
  lastUsedAt?: number
  createdAt: number
  updatedAt: number
}
