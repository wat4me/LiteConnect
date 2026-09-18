/** Separate existing application-generated suffixes while preserving ordinary explanation text. */
export function splitToolReason(reason?: string): { explanation: string; notice: string } {
  const text = (reason || '').trim()
  const separator = /[｜|](?=(?:命令实际风险高于申报|应用判级为|应用不认识|命令把代码直接交给了|命令要执行的脚本不在命令本身里|命令名在运行时才能确定|命令无法被完整解析|命令含高危特征))/
  const match = separator.exec(text)
  if (!match) return { explanation: text, notice: '' }
  return { explanation: text.slice(0, match.index).trim(), notice: text.slice(match.index + 1).trim() }
}
