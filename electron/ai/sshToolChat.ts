import { sshMcpToolsAsOpenAiFunctions } from '../../shared/mcp/tools'

export const MAX_SSH_TOOL_ROUNDS = 8

export type AccumulatedToolCall = {
  id: string
  name: string
  arguments: string
}

export function sshToolSystemAddendum(session: {
  sessionId: string
  host?: string
  username?: string
  connectionName?: string
}): string {
  const where = [session.connectionName, session.username && session.host ? `${session.username}@${session.host}` : session.host]
    .filter(Boolean)
    .join(' · ')
  return [
    '你可以使用 SSH 工具连接已保存的主机，并查看远端状态，不要空口猜测磁盘、进程、日志或配置。',
    '先 list_connections，再用 connect(connectionId) 连接。连接成功后，exec / read_file / write_file / list_dir 必须使用返回的 sessionId。',
    `当前侧栏会话已绑定 sessionId=${session.sessionId}${where ? `（${where}）` : ''}。若操作的就是这台机，可省略 sessionId。`,
    '远端命令、写文件、PTY、断开会话默认要等用户在对话里点「允许」才会执行。删根目录、mkfs、灌盘、关机会被直接拦截，不要尝试绕过。',
    '不要主动 disconnect 用户正在用的会话。多台机器可用 list_groups 再 exec(group=...)。长任务用 exec(background=true) 然后 get_job。',
    '需要安装向导、菜单、方向键时用 pty_open → pty_write → pty_read(mode=screen, waitForIdleMs=300) → pty_close。这是独立 PTY，不是用户终端。exec 仍是非交互命令。大文件用 upload_file / download_file。',
    'connect 只会使用 LiteConnect 里已保存的凭据，不要向用户索要密码。用户可能需要在应用里确认主机指纹。',
    '工具结果已经显示在卡片里。回复只给简短结论和下一步，不要原样粘贴大段 stdout/JSON。能用工具拿到的信息，不要让用户去终端复制。',
  ].join('\n')
}

export function bindSessionArgs(args: unknown, sessionId: string): Record<string, unknown> {
  const next =
    args && typeof args === 'object' && !Array.isArray(args) ? { ...(args as Record<string, unknown>) } : {}
  if (!next.sessionId && sessionId) next.sessionId = sessionId
  return next
}

export function accumulateToolCallDeltas(acc: Map<number, AccumulatedToolCall>, deltas: unknown): void {
  if (!Array.isArray(deltas)) return
  for (const raw of deltas) {
    if (!raw || typeof raw !== 'object') continue
    const d = raw as {
      index?: number
      id?: string
      function?: { name?: string; arguments?: string }
    }
    const idx = typeof d.index === 'number' ? d.index : acc.size
    const cur = acc.get(idx) || { id: '', name: '', arguments: '' }
    if (typeof d.id === 'string' && d.id) cur.id = d.id
    if (typeof d.function?.name === 'string') cur.name += d.function.name
    if (typeof d.function?.arguments === 'string') cur.arguments += d.function.arguments
    acc.set(idx, cur)
  }
}

export function parseToolCallArguments(raw: string): unknown {
  const text = raw.trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    return { command: text }
  }
}

export function sshToolsForChat() {
  return sshMcpToolsAsOpenAiFunctions()
}

export function looksLikeToolsUnsupported(message: string): boolean {
  const m = message.toLowerCase()
  return (
    /\btools?\b/.test(m) &&
    /not support|unsupported|unknown field|invalid|does not exist|not allowed|unrecognized/.test(m)
  )
}
