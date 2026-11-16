import { describe, expect, it } from 'vitest'
import { isPlausibleShellCommand } from './shellHistoryQuality'

describe('isPlausibleShellCommand', () => {
  it.each([
    'ls -la',
    'echo hi > out.txt',
    "grep -r 'a > b' .",
    'docker ps -a | grep web',
    'cd /srv && ls',
    'git commit -m "fix #12"',
    'echo it\\\'s',
  ])('keeps %s', (command) => {
    expect(isPlausibleShellCommand(command)).toBe(true)
  })

  it.each([
    '',
    '| grep web',
    '> out.txt',
    'docker ps |',
    'make &&',
    'cat <<EOF \\',
    'ops@edge-01:/srv$ ls',
    '[root@host ~]# ls',
    'echo "unterminated',
    "awk '{print $1",
    'ls\x1b[A',
  ])('rejects %j', (command) => {
    expect(isPlausibleShellCommand(command)).toBe(false)
  })
})
