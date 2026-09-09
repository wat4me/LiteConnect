import {
  AI_DECLARED_RISK_PARAM_DESCRIPTION,
  AI_DECLARED_RISK_PROMPT_ZH,
  AI_DECLARED_RISKS,
  toolRequiresDeclaredRisk,
} from './aiToolPolicy'
import { estimateTokens, packAiMessages, type AiContextPack } from './aiContext'
import { sshMcpToolsAsOpenAiFunctions } from './mcp/tools'
import type { AiChatMessage } from './types/ai'

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
    '你可以使用 SSH 工具查看和操作当前侧栏打开的这台主机，不要空口猜测磁盘、进程、日志或配置。',
    'exec / read_file / grep / glob / write_file / list_dir 默认就在这台机上执行，不要传 sessionId，也不要切换到其它主机。',
    '只读查看会自动执行。修改、提权、写文件、PTY、断开会话要等用户在对话里点「允许」。会不可逆破坏系统的操作会被直接拦截，不要尝试绕过。',
    AI_DECLARED_RISK_PROMPT_ZH,
    '长任务用 exec(background=true) 然后 get_job。不要去连其它主机或结束用户正在用的终端。',
    '需要安装向导、菜单、方向键时用 pty_open → pty_write → pty_read(mode=screen, waitForIdleMs=300) → pty_close。这是独立 PTY，不是用户终端。exec 仍是非交互命令。大文件用 upload_file / download_file。',
    '查日志和配置不要整文件 read_file。先 glob 找路径、grep 定位行号，再 read_file(startLine, limit) 读附近几十行。read_file 默认只返回前 200 行（约 50KiB）。',
    '工具结果已经显示在卡片里。回复只给简短结论和下一步，不要原样粘贴大段 stdout/JSON。能用工具拿到的信息，不要让用户去终端复制。',
    ...(cwd ? [`当前工作目录: ${cwd}。未写绝对路径时默认相对此目录。`] : []),
  ].join('\n')
}

const DECLARED_RISK_PARAM = {
  type: 'string',
  enum: [...AI_DECLARED_RISKS],
  description: AI_DECLARED_RISK_PARAM_DESCRIPTION,
} as const

function withDeclaredRiskParameter(schema: Record<string, unknown>): Record<string, unknown> {
  const properties =
    schema.properties && typeof schema.properties === 'object' && !Array.isArray(schema.properties)
      ? { ...(schema.properties as Record<string, unknown>), risk: DECLARED_RISK_PARAM }
      : { risk: DECLARED_RISK_PARAM }
  const required = Array.isArray(schema.required) ? [...schema.required.map(String)] : []
  if (!required.includes('risk')) required.push('risk')
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
  'Run a non-interactive command on the current sidebar host (separate exec channel, not the user terminal). Not for TTY prompts. Use stdin for a one-shot answer. Foreground timeout 1s–10min (default 30s). Longer work: background=true then get_job. Destructive/privileged commands need approval.'

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
      let parameters = omitSessionRoutingFromChatParameters(tool.function.parameters)
      if (toolRequiresDeclaredRisk(tool.function.name)) {
        parameters = withDeclaredRiskParameter(parameters)
      }
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
  /** OpenAI `tools[]` JSON, counted separately because packing does not reserve it. */
  toolSchemaTokens: number
  /** Packed prompt + tools schema — what the next sidebar request actually costs. */
  totalTokens: number
}

let cachedToolSchemaTokens = 0

/** Approximate tokens of the sidebar `tools[]` payload (stable; catalog is static). */
export function sidebarToolSchemaTokens(): number {
  if (!cachedToolSchemaTokens) {
    cachedToolSchemaTokens = estimateTokens(JSON.stringify(sshToolsForChat()))
  }
  return cachedToolSchemaTokens
}

/**
 * Same packing as `packRequestMessages` in the main process (system + SSH addendum +
 * transcript), then add `tools[]`. Does not rewrite kept history.
 */
export function estimateSidebarAiRequest(opts: {
  systemPrompt: string
  messages: AiChatMessage[]
  sessionId?: string
  cwd?: string
  model?: string
  contextWindowTokens?: number
}): SidebarAiRequestEstimate {
  const bound = Boolean(opts.sessionId)
  const extraSystem = bound
    ? sshToolSystemAddendum({
        sessionId: opts.sessionId || '',
        cwd: opts.cwd,
      })
    : ''
  const pack = packAiMessages({
    systemPrompt: [opts.systemPrompt, extraSystem].filter((s) => s && s.trim()).join('\n\n'),
    messages: opts.messages,
    model: opts.model,
    contextWindowTokens: opts.contextWindowTokens,
  })
  const toolSchemaTokens = bound ? sidebarToolSchemaTokens() : 0
  return {
    ...pack,
    toolSchemaTokens,
    totalTokens: pack.promptTokens + toolSchemaTokens,
  }
}
