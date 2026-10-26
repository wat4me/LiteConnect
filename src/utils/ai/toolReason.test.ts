import { expect, it } from 'vitest'
import { splitToolReason } from './toolReason'
import { AI_TOOL_REASON_SEPARATOR } from '@shared/aiToolPolicy'

it('splits current notices independently of the language of either field', () => {
  for (const notice of ['Application rating: destructive', '应用判级为「破坏性」']) {
    expect(splitToolReason(`Check A｜B${AI_TOOL_REASON_SEPARATOR}${notice}`)).toEqual({ explanation: 'Check A｜B', notice })
  }
})
it('separates application risk notices in stored reasons', () => {
  expect(splitToolReason('检查 nginx｜命令实际风险高于申报（应用判级为「破坏性」，申报「只读」）')).toEqual({ explanation: '检查 nginx', notice: '命令实际风险高于申报（应用判级为「破坏性」，申报「只读」）' })
  expect(splitToolReason('检查脚本|命令名在运行时才能确定，无法核实').notice).toContain('无法核实')
})
it('preserves ordinary separators and empty input', () => {
  expect(splitToolReason('查看 A｜B 配置')).toEqual({ explanation: '查看 A｜B 配置', notice: '' })
  expect(splitToolReason()).toEqual({ explanation: '', notice: '' })
})
