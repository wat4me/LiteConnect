import {
  AI_DECLARED_RISK_PARAM_DESCRIPTION,
  AI_DECLARED_RISKS,
  AI_TOOL_EXPLANATION_DESCRIPTION,
  AI_TOOL_EXPLANATION_MAX_CHARS,
} from './aiToolPolicy'
import { packAiMessages, type AiContextPack } from './aiContext'
import { formatAiConversationContextFile } from './aiFixedContext'
import { sshMcpToolsAsOpenAiFunctions } from './mcp/tools'
import { aiUserQuestionTool } from './aiQuestions'
import { sharedT, type SharedTranslate } from './i18n'
import { aiChatServerToolNames, aiLoadToolsDefinition, normalizeAiToolGroups, type AiToolGroup } from './aiToolCatalog'
import type { AiChatMessage, AiConversationContextFile } from './types/ai'
import { aiToolSchemaTokens, measureAiContextPressure, resolveAiContextBudget, type AiContextBudgetConfig } from './aiContextPressure'

export function sanitizeTrackedCwd(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const cwd = raw.trim()
  if (!cwd || cwd.length > 4096) return ''
  if (/[\0\r\n]/.test(cwd)) return ''
  // Relative leftovers like `v/v5-automation-servers` become `/v/...` if we prefix blindly.
  if (!cwd.startsWith('/')) return ''
  return cwd
}

export function sshToolSystemAddendum(session: {
  sessionId: string
  host?: string
  username?: string
  connectionName?: string
  cwd?: string
}, translate: SharedTranslate = sharedT, options: { workspace?: boolean; allowQuestions?: boolean } = {}): string {
  const cwd = sanitizeTrackedCwd(session.cwd)
  return [
    ...(options.workspace ? [] : [translate('sharedText.promptSshBound'), translate('sharedText.promptSshRouting')]),
    translate('sharedText.promptSshPermission'),
    translate('sharedText.promptRiskRequirements', { rules: translate('sharedText.promptRiskDeclaration') }),
    translate(options.allowQuestions === false ? 'sharedText.promptUnattended' : 'sharedText.promptQuestionGuidance'),
    translate('sharedText.promptBackground'),
    translate('sharedText.promptOptionalTools'),
    translate('sharedText.promptPty'),
    translate('sharedText.promptReadFiles'),
    translate('sharedText.promptEditFiles'),
    translate('sharedText.promptExactEdit'),
    translate('sharedText.promptReply'),
    translate('sharedText.promptVerify'),
    translate('sharedText.promptReport'),
    translate('sharedText.promptInterrupted'),
    ...(cwd ? [translate('sharedText.promptCwd', { cwd })] : []),
  ].join('\n')
}

const DECLARED_RISK_PARAM = {
  type: 'string',
  enum: [...AI_DECLARED_RISKS],
  description: AI_DECLARED_RISK_PARAM_DESCRIPTION,
} as const

function withDeclaredRiskParameter(schema: Record<string, unknown>): Record<string, unknown> {
  const declaration = {
    risk: DECLARED_RISK_PARAM,
    explanation: { type: 'string', minLength: 1, maxLength: AI_TOOL_EXPLANATION_MAX_CHARS, description: AI_TOOL_EXPLANATION_DESCRIPTION },
  }
  const properties =
    schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? { ...(schema.properties as Record<string, unknown>), ...declaration }
      : declaration
  const required = Array.isArray(schema.required) ? [...schema.required.map(String)] : []
  if (!required.includes('risk')) required.push('risk')
  if (!required.includes('explanation')) required.push('explanation')
  return { ...schema, properties, required }
}

const EXEC_CHAT_DESCRIPTION =
  'Run a non-interactive command on the current sidebar host (separate exec channel, not the user terminal). Not for TTY prompts. Use stdin for a one-shot answer. Foreground timeout 1s–10min (default 30s). Longer work: background=true. Completion status and stdout/stderr are delivered automatically to this conversation. Analyze the delivered result directly; do not call get_job to reconfirm completion or poll get_job / list_jobs or sleep while waiting. Use get_job only for user-requested progress or necessary output omitted by truncation. Include risk and explanation; the application applies the user permission mode.'

const BACKGROUND_CHAT_DESCRIPTION =
  'If true, return jobId(s) immediately. Completion status and stdout/stderr are delivered automatically to this conversation. Continue independent work or end your response while waiting. Do not poll get_job / list_jobs or sleep, or fetch an already delivered result again. Use get_job only for user-requested progress or necessary output omitted by truncation; cancel with cancel_job.'

// External MCP clients do not receive the application's completion delivery.
// Override their polling guidance only in the model-facing chat catalog.
const CHAT_TOOL_DESCRIPTIONS: Record<string, string> = {
  exec: EXEC_CHAT_DESCRIPTION,
  get_job: 'Inspect a background exec job only for user-requested progress or necessary output omitted from the automatic completion delivery by truncation. Completion status and stdout/stderr are delivered automatically; analyze that result directly. Do not use this tool to wait, poll, or reconfirm completion.',
  list_jobs: 'List recent background exec jobs when the user requests an overview or a job id must be recovered. Completion status and stdout/stderr are delivered automatically to this conversation. Do not poll this tool while waiting or routinely follow it with get_job to collect completed results.',
}

function omitSessionRoutingFromChatParameters(schema: Record<string, unknown>): Record<string, unknown> {
  const properties =
    schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? { ...(schema.properties as Record<string, unknown>) }
      : {}
  delete properties.sessionId
  delete properties.sessionIds
  delete properties.group
  delete properties.connectMissing
  // Chat owns approval, and a bound call never fans out; these are MCP-only knobs.
  delete properties.confirmed
  delete properties.concurrency
  const required = Array.isArray(schema.required)
    ? schema.required.map(String).filter(
        (key) => !['sessionId', 'sessionIds', 'group', 'connectMissing', 'confirmed', 'concurrency'].includes(key),
      )
    : []
  return { ...schema, properties, required }
}

export function sshToolsForChat(groups: readonly AiToolGroup[] = []) {
  const allowed = aiChatServerToolNames(groups)
  const tools = sshMcpToolsAsOpenAiFunctions()
    .filter((tool) => allowed.has(tool.function.name))
    .map((tool) => {
      const parameters = withDeclaredRiskParameter(omitSessionRoutingFromChatParameters(tool.function.parameters))
      if (tool.function.name === 'exec') {
        const properties = parameters.properties as Record<string, unknown>
        parameters.properties = {
          ...properties,
          background: { ...(properties.background as Record<string, unknown>), description: BACKGROUND_CHAT_DESCRIPTION },
        }
      }
      const description = CHAT_TOOL_DESCRIPTIONS[tool.function.name] ?? tool.function.description
      return {
        ...tool,
        function: {
          ...tool.function,
          description,
          parameters,
        },
      }
    })
  return [...tools, aiUserQuestionTool, aiLoadToolsDefinition]
}

export type SidebarAiRequestEstimate = AiContextPack & {
  pressure: ReturnType<typeof measureAiContextPressure>
  /** OpenAI `tools[]` JSON, counted separately because packing does not reserve it. */
  toolSchemaTokens: number
  /** Packed prompt + tools schema — what the next sidebar request actually costs. */
  totalTokens: number
}

const cachedToolSchemaTokens = new Map<string, number>()

/** Approximate sidebar `tools[]` tokens, cached per selected capability set. */
export function sidebarToolSchemaTokens(groups: readonly AiToolGroup[] = []): number {
  const key = normalizeAiToolGroups(groups).join(',')
  if (!cachedToolSchemaTokens.has(key)) cachedToolSchemaTokens.set(key, aiToolSchemaTokens(sshToolsForChat(groups)))
  return cachedToolSchemaTokens.get(key)!
}

/**
 * Same packing as `packRequestMessages` in the main process (system + SSH addendum +
 * transcript), then add `tools[]`. Does not rewrite kept history.
 */
export function estimateSidebarAiRequest(opts: AiContextBudgetConfig & {
  systemPrompt: string
  messages: AiChatMessage[]
  toolContext?: { system: string; schemaTokens: number }
  sessionId?: string
  cwd?: string
  model?: string
  contextWindowTokens?: number
  contextFiles?: AiConversationContextFile[]
  toolGroups?: readonly AiToolGroup[]
  translate?: SharedTranslate
}): SidebarAiRequestEstimate {
  const bound = Boolean(opts.sessionId)
  const extraSystem = opts.toolContext?.system ?? (bound
    ? sshToolSystemAddendum({
        sessionId: opts.sessionId || '',
        cwd: opts.cwd,
      }, opts.translate)
    : '')
  const files = opts.contextFiles || []
  const fixedContext = files.map(formatAiConversationContextFile).join('\n\n')
  const extra = [extraSystem, fixedContext].filter(text => text?.trim()).join('\n\n')
  const toolSchemaTokens = opts.toolContext?.schemaTokens ?? (bound ? sidebarToolSchemaTokens(opts.toolGroups) : 0)
  const pressure = measureAiContextPressure({ ...opts, extraSystem: extra, toolSchemaTokens })
  const pack = packAiMessages({
    systemPrompt: [opts.systemPrompt, extraSystem, fixedContext].filter((s) => s && s.trim()).join('\n\n'),
    systemMaxTokens: files.length ? 40_000 : undefined,
    messages: opts.messages,
    model: opts.model,
    contextWindowTokens: opts.contextWindowTokens,
    reserveOutputTokens: resolveAiContextBudget(opts).outputReserveTokens + toolSchemaTokens,
  })
  return {
    ...pack,
    toolSchemaTokens,
    totalTokens: pack.promptTokens + toolSchemaTokens,
    pressure,
  }
}

/** Match the main-process guard: every selected file body must survive system-message packing. */
export function sidebarContextFilesFit(opts: AiContextBudgetConfig & {
  systemPrompt: string
  toolContext?: { system: string; schemaTokens: number }
  sessionId?: string
  cwd?: string
  model?: string
  contextWindowTokens?: number
  contextFiles: AiConversationContextFile[]
  toolGroups?: readonly AiToolGroup[]
  translate?: SharedTranslate
}): boolean {
  if (!opts.contextFiles.length) return true
  const system = estimateSidebarAiRequest({ ...opts, messages: [] }).messages[0]?.content || ''
  return opts.contextFiles.every(file => system.includes(file.content))
}
