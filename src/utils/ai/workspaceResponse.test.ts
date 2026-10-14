import { describe, expect, it } from 'vitest'
import type { AiWorkspaceTarget } from '@shared/aiWorkspace'
import { workspaceResponseSections } from './workspaceResponse'

const targets: AiWorkspaceTarget[] = [
  { connectionId: 'app', sessionId: 'a', name: '应用服务器', host: '10.0.0.1', port: 22, username: 'root' },
  { connectionId: 'db', sessionId: 'b', name: '数据库服务器', host: '10.0.0.2', port: 22, username: 'root' },
]
describe('workspace response disclosures', () => {
  it('keeps the summary and next steps visible while identifying each server detail', () => {
    const sections = workspaceResponseSections('## 汇总\n| 主机 | 状态 |\n| --- | --- |\n| 应用 | 正常 |\n## 应用服务器 (10.0.0.1)\n正常\n### 进程\njava\n## 数据库服务器 (10.0.0.2)\n失败，未获得结果\n## 下一步\n重试数据库\n', targets)
    expect(sections.map(section => section.connectionId)).toEqual([undefined, 'app', 'db', undefined])
    expect(sections[1].text).toContain('### 进程\njava')
    expect(sections[2].text).toContain('失败，未获得结果')
    expect(sections[3].text).toBe('## 下一步\n重试数据库\n')
  })
  it('never treats headings inside fenced commands as server sections', () => {
    const text = '```bash\n## 应用服务器\necho test\n```\n~~~text\n## 数据库服务器\n~~~~\n'
    expect(workspaceResponseSections(text, targets)).toEqual([{ text }])
  })
  it('keeps unknown, ambiguous and prefix-only headings visible', () => {
    for (const text of ['## 10.0.0.10\nunknown', '## 应用服务器 与 数据库服务器\ncomparison', '## other server\nresult']) {
      expect(workspaceResponseSections(text, targets)).toEqual([{ text }])
    }
  })
  it('does not fold single-server responses or discard unstructured content', () => {
    const text = '## 应用服务器\ncontent <script>ignored</script>'
    expect(workspaceResponseSections(text, targets.slice(0, 1))).toEqual([{ text }])
    expect(workspaceResponseSections('plain result', targets)).toEqual([{ text: 'plain result' }])
  })
  it('supports duplicate names distinguished by host address and fenced headings inside details', () => {
    const sameNames = targets.map(target => ({ ...target, name: '服务器' }))
    // Ambiguous names must not override the unique host address.
    const sections = workspaceResponseSections('## 服务器 (10.0.0.1)\n```\n## 10.0.0.2\n```\n## 下一步\ncheck\n', sameNames)
    expect(sections[0].connectionId).toBe('app')
    expect(sections[0].text).toContain('## 10.0.0.2')
    expect(sections[1].connectionId).toBeUndefined()
  })
})
