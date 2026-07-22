import { describe, expect, it } from 'vitest'
import {
  buildBuiltinMap,
  buildSnippetExport,
  compareSnippets,
  extractSnippetVars,
  formatSnippetPayloadForWrite,
  matchSnippetHotkey,
  mergeImportedSnippets,
  parseSnippetImport,
  pendingSnippetVars,
  resolveSnippetCommand,
} from './commandSnippets'

describe('extractSnippetVars', () => {
  it('extracts single and double brace vars', () => {
    expect(extractSnippetVars('ssh {user}@{host} {{port}}')).toEqual(
      expect.arrayContaining(['user', 'host', 'port']),
    )
  })

  it('dedupes names', () => {
    expect(extractSnippetVars('{host} and {host}')).toEqual(['host'])
  })
})

describe('resolveSnippetCommand', () => {
  const ctx = { host: '10.0.0.1', user: 'root', port: 22, name: 'prod' }

  it('fills built-in single-brace vars', () => {
    expect(resolveSnippetCommand('ping {host} as {user}', ctx)).toBe('ping 10.0.0.1 as root')
  })

  it('fills double-brace built-ins', () => {
    expect(resolveSnippetCommand('echo {{name}}:{{port}}', ctx)).toBe('echo prod:22')
  })

  it('applies extra custom vars', () => {
    expect(resolveSnippetCommand('cd {path}', ctx, { path: '/var/log' })).toBe('cd /var/log')
  })

  it('leaves unknown when leaveUnknown', () => {
    expect(resolveSnippetCommand('x {missing}', ctx)).toBe('x {missing}')
  })

  it('aliases username/hostname', () => {
    expect(resolveSnippetCommand('{username}@{hostname}', { username: 'u', hostname: 'h' })).toBe('u@h')
  })

  it('fills date/time/clipboard from extra', () => {
    expect(
      resolveSnippetCommand('echo {date} {time} {clipboard}', ctx, {
        date: '2026-07-13',
        time: '12:00:00',
        clipboard: 'clip',
      }),
    ).toBe('echo 2026-07-13 12:00:00 clip')
  })
})

describe('pendingSnippetVars', () => {
  it('returns only unresolved custom vars', () => {
    expect(pendingSnippetVars('ssh {user}@{host} {{region}}', { host: 'h', user: 'u' })).toEqual(['region'])
  })

  it('does not require date/time/clipboard as custom prompts', () => {
    expect(pendingSnippetVars('log {date} {time} {clipboard}', {})).toEqual([])
  })
})

describe('buildBuiltinMap', () => {
  it('maps context fields', () => {
    expect(buildBuiltinMap({ host: 'a', user: 'b', port: 22 })).toEqual({
      host: 'a',
      user: 'b',
      port: '22',
    })
  })
})

describe('import/export', () => {
  it('builds and parses export payload with new fields', () => {
    const payload = buildSnippetExport([
      { name: 'n', command: 'ls', group: 'g', pinned: true, sendMode: 'fill', hotkey: 'Ctrl+Alt+1' },
    ])
    expect(payload.kind).toBe('LiteConnect-command-snippets')
    const parsed = parseSnippetImport(payload)
    expect(parsed).toEqual([
      {
        name: 'n',
        command: 'ls',
        group: 'g',
        pinned: true,
        sendMode: 'fill',
        hotkey: 'Ctrl+Alt+1',
      },
    ])
  })

  it('parses bare array', () => {
    expect(parseSnippetImport([{ name: 'a', command: 'pwd' }])).toEqual([
      { name: 'a', command: 'pwd', group: undefined, pinned: false, sendMode: 'run', hotkey: undefined },
    ])
  })

  it('merges append vs replace', () => {
    const existing = [{ id: '1', name: 'a', command: 'echo a' }]
    const imported = [{ name: 'b', command: 'echo b' }]
    expect(mergeImportedSnippets(existing, imported, 'append')).toHaveLength(2)
    expect(mergeImportedSnippets(existing, imported, 'replace')).toHaveLength(1)
  })
})

describe('compareSnippets', () => {
  it('puts pinned first', () => {
    const a = { name: 'b', pinned: false, sortOrder: 0 }
    const b = { name: 'a', pinned: true, sortOrder: 1 }
    expect(compareSnippets(b, a)).toBeLessThan(0)
  })
})

describe('formatSnippetPayloadForWrite', () => {
  it('appends newline for run mode', () => {
    expect(formatSnippetPayloadForWrite('ls', 'run')).toBe('ls\n')
  })
  it('keeps as-is for fill mode', () => {
    expect(formatSnippetPayloadForWrite('ls', 'fill')).toBe('ls')
  })
})

describe('matchSnippetHotkey', () => {
  it('matches ctrl+alt+1', () => {
    const e = {
      key: '1',
      ctrlKey: true,
      metaKey: false,
      altKey: true,
      shiftKey: false,
    } as KeyboardEvent
    expect(matchSnippetHotkey(e, 'Ctrl+Alt+1')).toBe(true)
    expect(matchSnippetHotkey(e, 'Ctrl+1')).toBe(false)
  })
})
