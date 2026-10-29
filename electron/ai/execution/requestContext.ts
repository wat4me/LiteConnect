import { t } from '../../i18n'
import { packAiMessages, type AiContextMessage } from '../../../shared/aiContext'
import type { AiChatMessage } from '../../../shared/types/ai'
import { resolveAiContextBudget, type AiContextBudgetConfig } from '../../../shared/aiContextPressure'
import type { AiWorkspaceTarget } from '../../../shared/aiWorkspace'
import { workspaceToolsForChat, workspaceToolSystemAddendum } from '../../../shared/aiWorkspacePrompt'
import { sshToolsForChat, sshToolSystemAddendum } from '../tools/sshToolChat'
import type { SshMcpRuntime } from '../../mcp/runtime'
import { isValidUUID } from '../../utils/validation'
import { AI_QUESTION_TOOL } from '../../../shared/aiQuestions'
import type { AiToolGroup } from '../../../shared/aiToolCatalog'
import { localFileTransferSystemAddendum } from './localEnvironment'
import { knowledgeTools, type AiKnowledgeAccess } from '../../../shared/aiKnowledge'

export async function buildAiRequestEnvironment(opts: {
  sessionId?: string; cwd?: string; workspaceTargets?: AiWorkspaceTarget[]
  sshMcpRuntime?: SshMcpRuntime
  allowQuestions?: boolean
  toolGroups?: readonly AiToolGroup[]
  knowledge?: AiKnowledgeAccess
}) {
  const boundSessionId = opts.sessionId && isValidUUID(opts.sessionId) ? opts.sessionId : ''
  const useTools = Boolean(opts.sshMcpRuntime && (opts.workspaceTargets?.length || boundSessionId))
  let extraSystem = ''
  if (opts.workspaceTargets) extraSystem = workspaceToolSystemAddendum(opts.workspaceTargets, t, opts.allowQuestions)
  else if (useTools && opts.sshMcpRuntime) {
    const listed = await opts.sshMcpRuntime.call('list_sessions', {})
    const sessions = (listed.structuredContent as { sessions?: Array<{ sessionId: string; host?: string; username?: string; connectionName?: string }> })?.sessions || []
    const snap = sessions.find(session => session.sessionId === boundSessionId)
    extraSystem = sshToolSystemAddendum({ sessionId: boundSessionId, ...snap, cwd: opts.cwd }, t, { allowQuestions: opts.allowQuestions })
  }
  if (opts.allowQuestions === false && !useTools) extraSystem = t('sharedText.promptUnattended')
  const localEnvironment = useTools ? localFileTransferSystemAddendum(opts.sshMcpRuntime?.getLocalEnvironment?.() ?? { platform: process.platform }, t) : ''
  const knowledgePrompt = await opts.knowledge?.prompt()
  extraSystem = [extraSystem, localEnvironment, knowledgePrompt, t('toolPolicy.visibleLanguage')].filter(text => text?.trim()).join('\n\n')
  const tools = useTools ? (opts.workspaceTargets ? workspaceToolsForChat(opts.toolGroups) : sshToolsForChat(opts.toolGroups)).filter(tool => opts.allowQuestions !== false || tool.function.name !== AI_QUESTION_TOOL) : undefined
  const localTools = useTools && knowledgePrompt ? knowledgeTools : []
  return { boundSessionId, useTools, extraSystem, tools: tools ? [...tools, ...localTools] : tools, localTools }
}

export function packRequestMessages(
  settings: AiContextBudgetConfig & { systemPrompt: string },
  incoming: AiChatMessage[],
  budgetTokens?: number,
  extraSystem?: string,
  systemMaxTokens?: number,
  toolSchemaTokens = 0,
): AiContextMessage[] {
  const systemPrompt = [settings.systemPrompt, extraSystem].filter((s) => s && s.trim()).join('\n\n')
  const packed = packAiMessages({
    systemPrompt,
    systemMaxTokens,
    messages: incoming.filter((m) => m.role !== 'system'),
    model: settings.model,
    budgetTokens,
    contextWindowTokens: settings.contextWindowTokens,
    reserveOutputTokens: resolveAiContextBudget(settings).outputReserveTokens + toolSchemaTokens,
  })
  const available = (budgetTokens ?? resolveAiContextBudget(settings).windowTokens) - resolveAiContextBudget(settings).outputReserveTokens
  if (packed.promptTokens > packed.budgetTokens && packed.messages.some(message => message.images?.length)) {
    throw new Error(t('notice.imageContextBudget'))
  }
  if (packed.promptTokens + toolSchemaTokens > available) {
    throw new Error(t('notice.contextBudget'))
  }
  return packed.messages
}
