/**
 * The AI sidebar trusts the model's own `risk` declaration, because only the
 * model knows what it is about to do. That is fine until the declaration and
 * the command disagree: a call labelled `read` that actually deletes a database
 * used to sail straight through in `auto` mode, and the classifier that could
 * have caught it was never consulted.
 *
 * This module composes the two. Ask mode escalates understated commands to
 * approval. Auto mode executes them at the application's higher risk level;
 * only commands classified as forbidden still require approval.
 *
 * The floor also has to stay *credible*. A classifier that says "this command
 * is more dangerous than you claimed" when it merely failed to recognise
 * `nginx -v` teaches the user that the card cries wolf, and then the one card
 * that matters gets clicked through. So the two cases are kept apart: an
 * observed risk escalates with an accusation, an unverifiable command escalates
 * with a plain "we could not check this".
 */
import type { AiDeclaredRisk, AiToolGate, AiToolPermissionMode } from '../../../shared/aiToolPolicy'
import { AI_TOOL_REASON_SEPARATOR } from '../../../shared/aiToolPolicy'
import { t } from '../../i18n'
import { classifyCommand } from '../../../shared/mcp/classify'
import type { CommandClass, CommandClassification, CommandUncertainty } from '../../../shared/mcp/types'

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
  'read-only': 'toolPolicy.classReadOnly',
  safe: 'toolPolicy.classSafe',
  destructive: 'toolPolicy.classDestructive',
  privileged: 'toolPolicy.classPrivileged',
  forbidden: 'toolPolicy.classForbidden',
}

const RISK_LABEL: Record<AiDeclaredRisk, string> = {
  read: 'toolPolicy.riskRead',
  write: 'toolPolicy.riskWrite',
  privileged: 'toolPolicy.riskPrivileged',
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
  const program = binary ? `"${binary}"` : t('toolPolicy.command')
  switch (uncertainty) {
    case 'unknown-program':
      return t('toolPolicy.unknownProgram', { program })
    case 'inline-script':
      return t('toolPolicy.inlineScript', { binary: binary || t('toolPolicy.interpreter') })
    case 'uninspectable':
      return t('toolPolicy.uninspectable')
    case 'runtime-name':
      return t('toolPolicy.runtimeName')
    case 'unparsed':
      return t('toolPolicy.unparsed')
  }
}

/**
 * The one sentence appended to the model's own explanation on the approval card.
 */
function escalationDetail(content: CommandClassification, declared: AiDeclaredRisk): string {
  const { class: cls, uncertainty, binary } = content
  if (uncertainty) return t('toolPolicy.confirmUnverified', { detail: uncertaintyPhrase(uncertainty, binary) })
  return t('toolPolicy.riskUnderstated', { actual: t(CLASS_LABEL[cls]), declared: t(RISK_LABEL[declared]) })
}

function denialDetail(content: CommandClassification): string {
  const { class: cls, uncertainty, binary } = content
  if (uncertainty) return uncertaintyPhrase(uncertainty, binary)
  return t('toolPolicy.classified', { actual: t(CLASS_LABEL[cls]) })
}

/**
 * Ask mode requires approval when the application's rating exceeds the model's.
 * Auto mode promotes the displayed risk and continues, except for forbidden
 * commands, which always require approval.
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
      reason: gate.reason + AI_TOOL_REASON_SEPARATOR + t('toolPolicy.readonlyDenied', { detail: denialDetail(content) }),
    }
  }

  const understated = RISK_RANK[gate.risk] < RISK_RANK[MINIMUM_DECLARATION[content.class]]
  if (mode === 'auto' && gate.action === 'allow') {
    if (content.class === 'forbidden') {
      return {
        action: 'ask', risk: gate.risk,
        reason: gate.reason + AI_TOOL_REASON_SEPARATOR + t('toolPolicy.forbidden', { actual: t(CLASS_LABEL[content.class]) }),
      }
    }
    if (!understated) return gate
    return {
      action: 'allow',
      risk: MINIMUM_DECLARATION[content.class],
      reason: gate.reason + AI_TOOL_REASON_SEPARATOR + t('toolPolicy.autoContinued', { detail: denialDetail(content) }),
    }
  }
  const catastrophic = content.class === 'forbidden' && gate.action === 'allow'
  if (!understated && !catastrophic) return gate

  const detail = catastrophic && !understated
    ? t('toolPolicy.forbidden', { actual: t(CLASS_LABEL[content.class]) })
    : escalationDetail(content, gate.risk)
  return { action: 'ask', risk: gate.risk, reason: gate.reason + AI_TOOL_REASON_SEPARATOR + detail }
}
