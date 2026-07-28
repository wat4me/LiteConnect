import { describe, expect, it } from 'vitest'
import { buildExplainErrorPrompt, buildSuggestNextPrompt } from './aiTerminalContext'

describe('aiTerminalContext', () => {
  it('includes terminal text and pwd in explain prompt', () => {
    const prompt = buildExplainErrorPrompt({
      terminalText: 'permission denied',
      source: 'scrollback',
      pwd: '/var/log',
      recentCommands: ['systemctl status nginx'],
      hostLabel: 'web-1',
    })
    expect(prompt).toContain('permission denied')
    expect(prompt).toContain('/var/log')
    expect(prompt).toContain('systemctl status nginx')
    expect(prompt).toContain('web-1')
  })

  it('builds suggest-next with history', () => {
    const prompt = buildSuggestNextPrompt({
      pwd: '/home/app',
      recentCommands: ['ls', 'df -h'],
      source: 'empty',
    })
    expect(prompt).toContain('/home/app')
    expect(prompt).toContain('df -h')
    expect(prompt).toMatch(/下一步/)
  })
})
