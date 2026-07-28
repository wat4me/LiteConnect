/**
 * Build AI prompts that include live terminal / session context.
 */

export type AiTerminalContextInput = {
  /** Recent terminal output or selection */
  terminalText?: string
  source?: 'selection' | 'scrollback' | 'empty'
  pwd?: string | null
  recentCommands?: string[]
  hostLabel?: string
}

function block(label: string, body: string): string {
  const trimmed = body.trim()
  if (!trimmed) return ''
  return `### ${label}\n\`\`\`\n${trimmed}\n\`\`\`\n`
}

export function buildExplainErrorPrompt(ctx: AiTerminalContextInput): string {
  const parts: string[] = [
    '请解释下面终端里**最近一段报错/异常输出**的含义，并给出可操作的排查步骤。',
    '要求：',
    '1. 用简洁中文说明「发生了什么」和「最可能原因」（按可能性排序）',
    '2. 给出 2～5 条安全排查命令（避免破坏性操作；如必须有风险请明确标注）',
    '3. 若信息不足，说明还需要哪些额外输出',
    '',
  ]
  if (ctx.hostLabel) parts.push(`主机：${ctx.hostLabel}`)
  if (ctx.pwd) parts.push(`当前目录（pwd）：\`${ctx.pwd}\``)
  if (ctx.recentCommands?.length) {
    parts.push(block('最近执行的命令', ctx.recentCommands.slice(0, 12).join('\n')))
  }
  const label =
    ctx.source === 'selection' ? '用户选中的终端文本' : '终端最近输出（滚动缓冲）'
  if (ctx.terminalText?.trim()) {
    parts.push(block(label, ctx.terminalText))
  } else {
    parts.push('（当前没有可用的终端输出；请根据通用 SSH/运维经验说明如何抓取报错上下文。）')
  }
  return parts.filter(Boolean).join('\n')
}

export function buildSuggestNextPrompt(ctx: AiTerminalContextInput): string {
  const parts: string[] = [
    '根据当前会话上下文，建议**下一步最合理的操作**（运维/排障导向）。',
    '要求：',
    '1. 先用 1～2 句话判断用户可能在做什么',
    '2. 给出 3～5 条建议，每条包含：目的 + 具体命令（可直接复制）',
    '3. 优先只读、安全的命令；危险命令必须单独标注风险并说明确认方式',
    '4. 不要编造不存在的路径或服务；信息不足时先建议收集信息的命令',
    '',
  ]
  if (ctx.hostLabel) parts.push(`主机：${ctx.hostLabel}`)
  if (ctx.pwd) parts.push(`当前目录（pwd）：\`${ctx.pwd}\``)
  if (ctx.recentCommands?.length) {
    parts.push(block('最近执行的命令', ctx.recentCommands.slice(0, 15).join('\n')))
  }
  if (ctx.terminalText?.trim()) {
    const label =
      ctx.source === 'selection' ? '用户选中的终端文本' : '终端最近输出'
    parts.push(block(label, ctx.terminalText))
  } else {
    parts.push('（暂无终端输出；请根据 pwd 与命令历史给出通用下一步建议。）')
  }
  return parts.filter(Boolean).join('\n')
}
