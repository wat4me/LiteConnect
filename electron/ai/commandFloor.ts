/**
 * The AI sidebar trusts the model's own `risk` declaration, because only the
 * model knows what it is about to do. That is fine until the declaration and
 * the command disagree: a call labelled `read` that actually deletes a database
 * used to sail straight through in `auto` mode, and the classifier that could
 * have caught it was never consulted.
 *
 * This module composes the two: the declaration still decides *whether* to ask,
 * and the independent command classification is applied as an escalate-only
 * floor. A gate is never lowered, so an honest declaration behaves exactly as
 * it did before.
 *
 * The floor also has to stay *credible*. A classifier that says "this command
 * is more dangerous than you claimed" when it merely failed to recognise
 * `nginx -v` teaches the user that the card cries wolf, and then the one card
 * that matters gets clicked through. So the two cases are kept apart: an
 * observed risk escalates with an accusation, an unverifiable command escalates
 * with a plain "we could not check this".
 */
import type { AiDeclaredRisk, AiToolGate, AiToolPermissionMode } from '../../shared/aiToolPolicy'
import { classifyCommand } from '../../shared/mcp/classify'
import type { CommandClass, CommandClassification, CommandUncertainty } from '../../shared/mcp/types'

const RISK_RANK: Record<AiDeclaredRisk, number> = { read: 0, write: 1, privileged: 2 }

/** The weakest declaration that honestly describes a command of this class. */
const MINIMUM_DECLARATION: Record<CommandClass, AiDeclaredRisk> = {
  'read-only': 'read',
  safe: 'write',
  destructive: 'write',
  privileged: 'privileged',
  forbidden: 'privileged',
}

const CLASS_LABEL: Record<CommandClass, string> = {
  'read-only': '只读',
  safe: '会改动状态',
  destructive: '破坏性',
  privileged: '提权',
  forbidden: '高危',
}

const RISK_LABEL: Record<AiDeclaredRisk, string> = {
  read: '只读',
  write: '修改',
  privileged: '提权',
}

/** `service_control` only inspects the unit for this action. */
const SERVICE_READ_ACTIONS = new Set(['status'])

/** Tools whose payload we can judge independently of what the model claims. */
const EXEC_TOOLS = new Set(['exec', 'service_control'])

/**
 * The classifier's verdict on the command a tool is about to run, or null when
 * the tool runs nothing we can rate (file tools, sessions, pty, metrics).
 */
export function commandContentRisk(tool: string, args: unknown): CommandClassification | null {
  if (!EXEC_TOOLS.has(tool)) return null
  const input = args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
  if (tool === 'service_control') {
    const action = typeof input.action === 'string' ? input.action.trim() : 'status'
    if (SERVICE_READ_ACTIONS.has(action)) {
      return { class: 'read-only', binary: '', reason: `service_control ${action}` }
    }
    return { class: 'destructive', binary: '', reason: `service_control ${action}` }
  }
  const command = typeof input.command === 'string' ? input.command : ''
  if (!command.trim()) return null
  return classifyCommand(command)
}

/**
 * Why we could not establish the command's behaviour, in the user's words.
 * Never phrased as a claim about the model.
 */
function uncertaintyPhrase(uncertainty: CommandUncertainty, binary: string): string {
  const program = binary ? `「${binary}」` : '这条命令'
  switch (uncertainty) {
    case 'unknown-program':
      return `应用不认识 ${program}，无法核实它会做什么`
    case 'inline-script':
      return `命令把代码直接交给了 ${binary || '解释器'}，内容无法预先核实`
    case 'uninspectable':
      return '命令要执行的脚本不在命令本身里（脚本文件或标准输入），无法核实'
    case 'runtime-name':
      return '命令名在运行时才能确定，无法核实'
    case 'unparsed':
      return '命令无法被完整解析，无法核实'
  }
}

/**
 * The one sentence appended to the model's own explanation on the approval card.
 */
function escalationDetail(content: CommandClassification, declared: AiDeclaredRisk): string {
  const { class: cls, uncertainty, binary } = content
  if (uncertainty) return `${uncertaintyPhrase(uncertainty, binary)}，需要你确认后再执行`
  return `命令实际风险高于申报（应用判级为「${CLASS_LABEL[cls]}」，申报「${RISK_LABEL[declared]}」）`
}

function denialDetail(content: CommandClassification): string {
  const { class: cls, uncertainty, binary } = content
  if (uncertainty) return uncertaintyPhrase(uncertainty, binary)
  return `应用判级为「${CLASS_LABEL[cls]}」`
}

/**
 * Escalate only. A command the classifier rates above the model's declaration
 * always needs a click, in every permission mode, and a `forbidden` command is
 * never auto-approved even when the declaration is honest.
 */
export function applyCommandFloor(
  gate: AiToolGate,
  content: CommandClassification | null,
  mode: AiToolPermissionMode = 'ask',
): AiToolGate {
  if (!content) return gate
  if (gate.action === 'reclassify' || gate.action === 'deny') return gate

  if (mode === 'readonly' && content.class !== 'read-only') {
    return {
      action: 'deny',
      risk: gate.risk,
      code: 'READONLY_MODE',
      reason: `${gate.reason}｜${denialDetail(content)}，只读模式下不予执行`,
    }
  }

  const understated = RISK_RANK[gate.risk] < RISK_RANK[MINIMUM_DECLARATION[content.class]]
  const catastrophic = content.class === 'forbidden' && gate.action === 'allow'
  if (!understated && !catastrophic) return gate

  const detail = catastrophic && !understated
    ? `命令含高危特征（应用判级为「${CLASS_LABEL[content.class]}」）`
    : escalationDetail(content, gate.risk)
  return { action: 'ask', risk: gate.risk, reason: `${gate.reason}｜${detail}` }
}
