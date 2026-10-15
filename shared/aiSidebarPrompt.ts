import {
  AI_DECLARED_RISK_PARAM_DESCRIPTION,
  AI_DECLARED_RISK_PROMPT_ZH,
  AI_DECLARED_RISKS,
  AI_TOOL_EXPLANATION_DESCRIPTION,
  AI_TOOL_EXPLANATION_MAX_CHARS,
} from './aiToolPolicy'
import { estimateTokens, packAiMessages, type AiContextPack } from './aiContext'
import { formatAiConversationContextFile } from './aiFixedContext'
import { sshMcpToolsAsOpenAiFunctions } from './mcp/tools'
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
}): string {
  const cwd = sanitizeTrackedCwd(session.cwd)
  return [
    '你可以使用 SSH 工具查看和操作当前对话绑定的这台主机，不要空口猜测磁盘、进程、日志或配置。',
    'exec / read_file / grep / glob / write_file / edit_file / list_dir 默认就在这台机上执行，不要传 sessionId，也不要切换到其它主机。',
    '工具权限按你在 JSON 中声明的级别和用户设置处理；需要确认的调用会暂停，等待用户在对话里点「允许」。',
    AI_DECLARED_RISK_PROMPT_ZH,
    '长任务用 exec(background=true)。任务完成后应用会自动将结果送回当前对话并继续处理，无需反复 get_job 或 sleep 等待。后台执行期间可处理独立工作，不要重复执行同一任务；仅在需要主动查看进度或更多输出时使用 get_job。不要去连其它主机或结束用户正在用的终端。',
    '需要安装向导、菜单、方向键时用 pty_open → pty_write → pty_read(mode=screen, waitForIdleMs=300) → pty_close。这是独立 PTY，不是用户终端。exec 仍是非交互命令。大文件用 upload_file / download_file。',
    '查日志和配置不要整文件 read_file。先 glob 找路径、grep 定位行号，再 read_file(startLine, limit) 读附近几十行。read_file 默认只返回前 200 行（约 50KiB）。',
    '改已存在的文件用 edit_file：它只传改动片段、其余内容原样不动，审批卡上给出的是小而可读的 diff。只有新建文件或整体重写才用 write_file。',
    'edit_file 的 oldString 必须逐字来自 read_file 返回的内容（含缩进与引号），不要带行号前缀；匹配不唯一时补上足够上下文，或明确用 replaceAll。行首的行号只是定位标记，任何时候都不要复制进 oldString / newString / write_file 的 content。',
    '工具结果已经显示在卡片里。回复只给简短结论和下一步，不要原样粘贴大段 stdout/JSON。能用工具拿到的信息，不要让用户去终端复制。',
    '修改文件、部署、安装或重启后，须在同一台服务器上用只读工具复查用户要求的实际结果（如配置内容、服务状态、端口响应或近期日志）。命令返回成功、退出码为 0 或后台任务启动成功，都不等于用户目标已完成。只做与本次请求相关且必要的验证，不自行扩展修改范围。',
    '最终说明已验证的结果、失败项和未验证项；没有复查依据时明确写「尚未验证」，不要声称已修复。多服务器分别验证和报告；一台失败不代表其他主机失败，也不能用其他主机成功的结果代替本机验证。',
    '超时、断线或取消后，远端修改可能已经生效，也可能只完成了一部分；不要假定已回滚或直接重复执行。继续任务时先读取实际状态，再决定剩余操作；后台结果中的失败也要复核，不能只看任务状态 completed。',
    ...(cwd ? [`当前工作目录: ${cwd}。未写绝对路径时默认相对此目录。`] : []),
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

const SIDEBAR_HIDDEN_TOOLS = new Set([
  'list_connections',
  'list_sessions',
  'list_groups',
  'connect',
  'save_connection',
  'disconnect',
])

const EXEC_CHAT_DESCRIPTION =
  'Run a non-interactive command on the current sidebar host (separate exec channel, not the user terminal). Not for TTY prompts. Use stdin for a one-shot answer. Foreground timeout 1s–10min (default 30s). Longer work: background=true. Completion results are delivered automatically to this conversation; do not poll get_job or sleep while waiting. Use get_job only for requested progress or additional output. Include risk and explanation; the application applies the user permission mode.'

function omitSessionRoutingFromChatParameters(schema: Record<string, unknown>): Record<string, unknown> {
  const properties =
    schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? { ...(schema.properties as Record<string, unknown>) }
      : {}
  delete properties.sessionId
  delete properties.sessionIds
  delete properties.group
  delete properties.connectMissing
  const required = Array.isArray(schema.required)
    ? schema.required.map(String).filter(
        (key) => key !== 'sessionId' && key !== 'sessionIds' && key !== 'group' && key !== 'connectMissing',
      )
    : []
  return { ...schema, properties, required }
}

export function sshToolsForChat() {
  return sshMcpToolsAsOpenAiFunctions()
    .filter((tool) => !SIDEBAR_HIDDEN_TOOLS.has(tool.function.name))
    .map((tool) => {
      const parameters = withDeclaredRiskParameter(omitSessionRoutingFromChatParameters(tool.function.parameters))
      const description = tool.function.name === 'exec' ? EXEC_CHAT_DESCRIPTION : tool.function.description
      return {
        ...tool,
        function: {
          ...tool.function,
          description,
          parameters,
        },
      }
    })
}

export type SidebarAiRequestEstimate = AiContextPack & {
  pressure: ReturnType<typeof measureAiContextPressure>
  /** OpenAI `tools[]` JSON, counted separately because packing does not reserve it. */
  toolSchemaTokens: number
  /** Packed prompt + tools schema — what the next sidebar request actually costs. */
  totalTokens: number
}

let cachedToolSchemaTokens = 0

/** Approximate tokens of the sidebar `tools[]` payload (stable; catalog is static). */
export function sidebarToolSchemaTokens(): number {
  if (!cachedToolSchemaTokens) {
    cachedToolSchemaTokens = aiToolSchemaTokens(sshToolsForChat())
  }
  return cachedToolSchemaTokens
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
}): SidebarAiRequestEstimate {
  const bound = Boolean(opts.sessionId)
  const extraSystem = opts.toolContext?.system ?? (bound
    ? sshToolSystemAddendum({
        sessionId: opts.sessionId || '',
        cwd: opts.cwd,
      })
    : '')
  const files = opts.contextFiles || []
  const fixedContext = files.map(formatAiConversationContextFile).join('\n\n')
  const extra = [extraSystem, fixedContext].filter(text => text?.trim()).join('\n\n')
  const toolSchemaTokens = opts.toolContext?.schemaTokens ?? (bound ? sidebarToolSchemaTokens() : 0)
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
}): boolean {
  if (!opts.contextFiles.length) return true
  const system = estimateSidebarAiRequest({ ...opts, messages: [] }).messages[0]?.content || ''
  return opts.contextFiles.every(file => system.includes(file.content))
}
