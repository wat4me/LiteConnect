import { describe, expect, it } from 'vitest'
import {
  commandOutputAfterEcho,
  endsWithShellPrompt,
  looksLikeFailedShellOutput,
  promptTerminator,
  stripAnsiForHistory,
} from '@/utils/terminal/shellHistoryEligibility'

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

  it('detects localized bash command-not-found output', () => {
    expect(looksLikeFailedShellOutput('bash: odkcer: 未找到命令...')).toBe(true)
    expect(looksLikeFailedShellOutput('-bash: odkcer: 找不到命令')).toBe(true)
  })

  it('detects with ansi codes', () => {
    const raw = "\x1b[31mdocker: 'p' is not a docker command.\x1b[0m"
    expect(stripAnsiForHistory(raw)).toContain('is not a docker command')
    expect(looksLikeFailedShellOutput(raw)).toBe(true)
  })

  it.each([
    'bash: cd: /nope: No such file or directory',
    "ls: cannot access 'x': No such file or directory",
    'cat: /etc/shadow: Permission denied',
    'sh: 1: foo: not found',
    "-bash: syntax error near unexpected token `)'",
    'cp: missing file operand\nTry \'cp --help\' for more information.',
    'usage: git [-v | --version] [-h | --help]',
    'Unit nginxx.service could not be found.',
    'E: Unable to locate package htopp',
    'ls：无法访问 \'x\': 没有那个文件或目录',
    "ls: 无效的选项 -- 'y'",
    'Error: unknown shorthand flag: \'z\' in -z',
  ])('detects invocation error %j', (output) => {
    expect(looksLikeFailedShellOutput(output)).toBe(true)
  })

  it('ignores the echoed command line itself', () => {
    const raw = 'grep "command not found" app.log\r\n2026-11-06 ok\r\n'
    expect(looksLikeFailedShellOutput(commandOutputAfterEcho(raw, 'grep "command not found" app.log'))).toBe(false)
  })

  it('only inspects the start of long output', () => {
    expect(looksLikeFailedShellOutput(`${'line\n'.repeat(2000)}cat: x: No such file or directory`)).toBe(false)
  })

  it('recognises the prompt returning after output', () => {
    expect(endsWithShellPrompt('total 3\r\nops@edge:/srv$ ', '$')).toBe(true)
    expect(endsWithShellPrompt('downloading 40%', '$')).toBe(false)
    expect(endsWithShellPrompt('price is 5$', '$')).toBe(false)
    expect(promptTerminator('[root@host ~]# ')).toBe('#')
  })

  it('does not flag normal success / prompt noise', () => {
    expect(looksLikeFailedShellOutput('CONTAINER ID   IMAGE\nabc123         nginx')).toBe(false)
    expect(looksLikeFailedShellOutput('[root@localhost ~]# ')).toBe(false)
    expect(looksLikeFailedShellOutput('total 12\ndrwxr-xr-x 2 root root')).toBe(false)
    expect(looksLikeFailedShellOutput('这是说明文字：未找到命令时请检查拼写')).toBe(false)
  })
})
