import { packAiMessages, type AiContextMessage } from '../../../shared/aiContext'
import type { AiChatMessage } from '../../../shared/types/ai'
import { resolveAiContextBudget, type AiContextBudgetConfig } from '../../../shared/aiContextPressure'
import type { AiConversationContextFile } from '../../../shared/types/ai'
import type { AiWorkspaceTarget } from '../../../shared/aiWorkspace'
import { formatAiConversationContextFile } from '../../../shared/aiFixedContext'
import { workspaceToolsForChat, workspaceToolSystemAddendum } from '../../../shared/aiWorkspacePrompt'
import { sshToolsForChat, sshToolSystemAddendum } from '../tools/sshToolChat'
import type { SshMcpRuntime } from '../../mcp/runtime'
import { isValidUUID } from '../../utils/validation'
import { AI_QUESTION_GUIDANCE, AI_QUESTION_TOOL } from '../../../shared/aiQuestions'

export async function buildAiRequestEnvironment(opts: {
  sessionId?: string; cwd?: string; workspaceTargets?: AiWorkspaceTarget[]
  contextFiles?: AiConversationContextFile[]; sshMcpRuntime?: SshMcpRuntime
  allowQuestions?: boolean
}) {
  const boundSessionId = opts.sessionId && isValidUUID(opts.sessionId) ? opts.sessionId : ''
  const useTools = Boolean(opts.sshMcpRuntime && (opts.workspaceTargets?.length || boundSessionId))
  let extraSystem = ''
  if (opts.workspaceTargets) extraSystem = workspaceToolSystemAddendum(opts.workspaceTargets)
  else if (useTools && opts.sshMcpRuntime) {
    const listed = await opts.sshMcpRuntime.call('list_sessions', {})
    const sessions = (listed.structuredContent as { sessions?: Array<{ sessionId: string; host?: string; username?: string; connectionName?: string }> })?.sessions || []
    const snap = sessions.find(session => session.sessionId === boundSessionId)
    extraSystem = sshToolSystemAddendum({ sessionId: boundSessionId, ...snap, cwd: opts.cwd })
  }
  if (opts.allowQuestions === false) extraSystem = extraSystem.split('\n').filter(line => line !== AI_QUESTION_GUIDANCE).join('\n') + '\n本次为无人值守任务，不提供交互提问工具。缺少信息时报告限制并完成可执行的检查，不等待人工回答，也不自行扩大范围。'
  extraSystem = [extraSystem, ...(opts.contextFiles || []).map(formatAiConversationContextFile)].filter(text => text?.trim()).join('\n\n')
  const tools = useTools ? (opts.workspaceTargets ? workspaceToolsForChat() : sshToolsForChat()).filter(tool => opts.allowQuestions !== false || tool.function.name !== AI_QUESTION_TOOL) : undefined
  return { boundSessionId, useTools, extraSystem, tools }
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
    throw new Error('图片超出当前模型的上下文预算，请减少图片或调整模型上下文窗口')
  }
  if (packed.promptTokens + toolSchemaTokens > available) {
    throw new Error('系统提示、工具定义或最近的消息超出模型上下文预算，请减少资料或调整模型预算。')
  }
  return packed.messages
}
