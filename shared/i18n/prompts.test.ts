import { describe, expect, it } from 'vitest'
import { createSharedTranslator } from './index'
import { sshToolSystemAddendum } from '../aiSidebarPrompt'
import { workspaceToolSystemAddendum } from '../aiWorkspacePrompt'
import { aiHistoryRecordForSummary, frameAiContextCheckpoint, pruneAiToolResultText } from '../aiCompaction'
import { clampToolResultForModel } from '../mcp/toolResultClamp'
import type { AiWorkspaceTarget } from '../aiWorkspace'

const en = createSharedTranslator('en-US')
const target: AiWorkspaceTarget = { connectionId: 'host-one', sessionId: 'session-one', name: 'Web', host: 'example.test', port: 22, username: 'deploy' }

describe('localized model guidance', () => {
  it('localizes SSH guidance without changing tool names or permissions', () => {
    const prompt = sshToolSystemAddendum({ sessionId: 'one', cwd: '/srv/app' }, en)
    expect(prompt).not.toMatch(/\p{Script=Han}/u)
    for (const declaration of ['- read (read-only)', '- write:', '- privileged:']) expect(prompt).toContain(declaration)
    expect(prompt).toContain('exec(background=true)')
    expect(prompt).toContain('Current working directory: /srv/app')
    expect(prompt).toContain('Do not poll')
    expect(prompt).toContain('Do not assume rollback')
  })

  it('builds unattended workspace guidance structurally and preserves user data', () => {
    const prompt = workspaceToolSystemAddendum([target], en, false)
    expect(prompt).not.toMatch(/\p{Script=Han}/u)
    expect(prompt).toContain('must explicitly include connectionId')
    expect(prompt).toContain(en('sharedText.promptUnattended'))
    expect(prompt).not.toContain(en('sharedText.promptQuestionGuidance'))
    expect(prompt).not.toContain(en('sharedText.promptSshRouting'))
    const withNote = workspaceToolSystemAddendum([{ ...target, note: '用户备注' }], en)
    expect(withNote).toContain('"note":"用户备注"')
  })

  it('localizes checkpoint wrappers without rewriting execution facts or source text', () => {
    const checkpoint = frameAiContextCheckpoint('用户原始摘要', en)
    expect(checkpoint.content).toContain('application-generated checkpoint')
    expect(checkpoint.content).toContain('<compacted-summary>\n用户原始摘要\n</compacted-summary>')
    const record = aiHistoryRecordForSummary({ id: 'one', role: 'assistant', createdAt: 1, toolRuns: [{ id: 'call', name: 'exec', args: '{"command":"ls"}', content: 'server output', isError: false, status: 'running' }], content: '' }, 5_000, en)
    expect(record?.content).toContain('execution result unknown')
    expect(record?.content).not.toContain('goal still requires verification')
    expect(record?.content).toContain('server output')
    expect(pruneAiToolResultText('x'.repeat(10_000), en)).toContain('removed during context compaction')
  })

  it('uses localized truncation guidance and avoids duplicate notices', () => {
    const result = clampToolResultForModel({ isError: false, content: 'x'.repeat(50_000) }, en)
    expect(result.content).toContain('[Truncated]')
    expect(result.content).toContain('read_file(startLine, limit)')
    expect(result.content).not.toMatch(/\p{Script=Han}/u)
    const repeated = clampToolResultForModel(result, en)
    expect(repeated.content.split(en('sharedText.promptTruncation'))).toHaveLength(2)
  })
})
