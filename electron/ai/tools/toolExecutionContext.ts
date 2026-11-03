import type { AiWorkspaceTarget } from '../../../shared/aiWorkspace'
import type { AiChatStreamPayload, AiToolPermissionMode } from '../../../shared/types/ai'
import type { AiToolGroup } from '../../../shared/aiToolCatalog'
import type { AiDeclaredRisk } from '../../../shared/aiToolPolicy'
import type { CommandClass } from '../../../shared/mcp/types'
import type { SshMcpRuntime } from '../../mcp/runtime'
import type { McpTransferContext } from '../../mcp/ports'
import type { AiKnowledgeAccess } from '../../../shared/aiKnowledge'

export type AiToolApprovalObserver = (input: { requestId: string; callId: string; sessionId: string; toolName: string }) => void | (() => void)

/** A delayed background exec, approved now and started later without asking again. */
export type AiScheduledExecInput = {
  sessionId: string
  command: string
  stdin?: string
  jobTimeoutMs: number
  startAfterMs: number
  note?: string
  risk: AiDeclaredRisk
  class: CommandClass
}

/** Contract consumed by tool handlers; independent of the dispatcher implementation. */
export type AiToolExecutionContext = {
  requestId: string
  boundSessionId: string
  workspaceTargets?: AiWorkspaceTarget[]
  sshMcpRuntime: SshMcpRuntime
  knowledge?: AiKnowledgeAccess
  signal: AbortSignal
  transferContext?: McpTransferContext
  send: (payload: AiChatStreamPayload) => void
  getToolPermission: () => AiToolPermissionMode
  checkpoint?: () => Promise<void>
  foregroundOnly?: boolean
  allowQuestions?: boolean
  availableTools?: ReadonlySet<string>
  loadTools?: (groups: AiToolGroup[]) => { loadedGroups: AiToolGroup[]; tools: string[] }
  onToolApprovalRequested?: AiToolApprovalObserver
  onBackgroundJobsStarted?: (jobIds: string[]) => void
  onBackgroundJobCollected?: (jobId: string) => void
  /** Absent when scheduling is unavailable: automation runs and workspace sessions. */
  scheduleBackgroundJob?: (input: AiScheduledExecInput) => Promise<{ jobId: string; dueAt: number }>
}
