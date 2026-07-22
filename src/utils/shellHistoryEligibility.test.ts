import { describe, expect, it } from 'vitest'
import { looksLikeFailedShellOutput, stripAnsiForHistory } from './shellHistoryEligibility'

describe('looksLikeFailedShellOutput', () => {
  it('detects docker invalid subcommand', () => {
    expect(
      looksLikeFailedShellOutput("docker: 'p' is not a docker command.\nSee 'docker --help'"),
    ).toBe(true)
  })

  it('detects bash command not found', () => {
    expect(looksLikeFailedShellOutput('bash: foobarbaz: command not found')).toBe(true)
    expect(looksLikeFailedShellOutput('-bash: xyz: command not found')).toBe(true)
  })

  it('detects with ansi codes', () => {
    const raw = "\x1b[31mdocker: 'p' is not a docker command.\x1b[0m"
    expect(stripAnsiForHistory(raw)).toContain('is not a docker command')
    expect(looksLikeFailedShellOutput(raw)).toBe(true)
  })

  it('does not flag normal success / prompt noise', () => {
    expect(looksLikeFailedShellOutput('CONTAINER ID   IMAGE\nabc123         nginx')).toBe(false)
    expect(looksLikeFailedShellOutput('[root@localhost ~]# ')).toBe(false)
    expect(looksLikeFailedShellOutput('total 12\ndrwxr-xr-x 2 root root')).toBe(false)
  })
})
