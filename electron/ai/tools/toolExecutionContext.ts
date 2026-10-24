import type { AiWorkspaceTarget } from '../../../shared/aiWorkspace'
import type { AiChatStreamPayload, AiToolPermissionMode } from '../../../shared/types/ai'
import type { AiToolGroup } from '../../../shared/aiToolCatalog'
import type { SshMcpRuntime } from '../../mcp/runtime'
import type { McpTransferContext } from '../../mcp/ports'

export type AiToolApprovalObserver = (input: { requestId: string; callId: string; sessionId: string; toolName: string }) => void | (() => void)

/** Contract consumed by tool handlers; independent of the dispatcher implementation. */
export type AiToolExecutionContext = {
  requestId: string
  boundSessionId: string
  workspaceTargets?: AiWorkspaceTarget[]
  sshMcpRuntime: SshMcpRuntime
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
}
