import { describe, expect, it } from 'vitest'
import {
  extractJsonStringField,
  formatToolRunDisplay,
  serializeToolRunForHistory,
  toolRunDefaultOpen,
} from './aiToolRunDisplay'

describe('formatToolRunDisplay', () => {
  it('does not put save_connection passwords into the hint', () => {
    const view = formatToolRunDisplay({
      name: 'save_connection',
      args: JSON.stringify({
        host: '10.0.0.8',
        username: 'root',
        password: 'super-secret',
        connect: true,
      }),
      content: JSON.stringify({
        id: 'abc',
        name: 'root@10.0.0.8',
        host: '10.0.0.8',
        username: 'root',
        created: true,
      }),
    })
    expect(view.hint).not.toContain('super-secret')
    expect(view.hint).toContain('10.0.0.8')
  })

  it('extracts exec stdout instead of dumping JSON escapes', () => {
    const view = formatToolRunDisplay({
      name: 'exec',
      args: JSON.stringify({ sessionId: 'aaa', command: 'df -h' }),
      content: JSON.stringify(
        {
          sessionId: 'aaa',
          connectionName: '10.2.5.223',
          exitCode: 0,
          stdout: 'Filesystem  Size\n/dev/root   168G\n',
          stderr: '',
        },
        null,
        2,
      ),
    })
    expect(view.hint).toBe('df -h')
    expect(view.summary).toEqual({ kind: 'exit', code: 0, truncated: false, host: '10.2.5.223' })
    expect(view.body).toBe('Filesystem  Size\n/dev/root   168G')
    expect(view.body).not.toContain('\\n')
  })

  it('recovers stdout from truncated JSON', () => {
    const prefix = '{"sessionId":"x","stdout":"HEAD\\nTAIL'
    expect(extractJsonStringField(prefix, 'stdout')).toBe('HEAD\nTAIL')
    const view = formatToolRunDisplay({
      name: 'exec',
      args: '{"command":"ps"}',
      content: prefix,
    })
    expect(view.body).toBe('HEAD\nTAIL')
  })

  it('summarizes session lists instead of dumping ids', () => {
    const view = formatToolRunDisplay({
      name: 'list_sessions',
      args: '{}',
      content: JSON.stringify({
        sessions: [
          {
            sessionId: '9f89904d-322d-41d0-b849-0f872a3e46e9',
            connectionName: '10.2.5.223',
            host: '10.2.5.223',
            username: 'root',
            port: 22,
            healthy: true,
          },
          {
            sessionId: 'bc43430f-e7c5-45d2-a89e-0614928204b4',
            connectionName: '10.2.178.202',
            host: '10.2.178.202',
            username: 'root',
            port: 22,
            healthy: true,
          },
        ],
      }),
    })
    expect(view.summary).toEqual({ kind: 'sessions', count: 2 })
    expect(view.hint).toBe('')
    expect(view.body).toBe('root@10.2.5.223  ok\nroot@10.2.178.202  ok')
  })

  it('shows policy errors as a one-line summary', () => {
    const view = formatToolRunDisplay({
      name: 'exec',
      args: JSON.stringify({ command: 'ss -lntp 2>/dev/null' }),
      content: 'DESTRUCTIVE_DENIED: Destructive command is not allowed: shell write redirection',
      isError: true,
    })
    expect(view.hint).toBe('ss -lntp 2>/dev/null')
    expect(view.summary).toEqual({
      kind: 'text',
      text: 'DESTRUCTIVE_DENIED: Destructive command is not allowed: shell write redirection',
    })
    expect(view.body).toBe('DESTRUCTIVE_DENIED: Destructive command is not allowed: shell write redirection')
  })

  it('serializes exec history as compact JSON with real stdout, not pretty-printed escapes', () => {
    const stored = serializeToolRunForHistory({
      name: 'exec',
      args: JSON.stringify({ sessionId: 'aaa', command: 'uptime' }),
      content: JSON.stringify({ exitCode: 0, stdout: '12:00:01 up 3 days', stderr: '' }, null, 2),
      isError: false,
    })
    expect(stored.args).toBe('uptime')
    expect(JSON.parse(stored.content)).toEqual({
      exitCode: 0,
      stdout: '12:00:01 up 3 days',
    })
    const view = formatToolRunDisplay({ name: 'exec', args: stored.args, content: stored.content })
    expect(view.body).toBe('12:00:01 up 3 days')
    expect(view.summary).toEqual({ kind: 'exit', code: 0, truncated: false, host: undefined })
  })

  it('round-trips list_sessions into a compact listing', () => {
    const stored = serializeToolRunForHistory({
      name: 'list_sessions',
      args: '{}',
      content: JSON.stringify({
        sessions: [
          { connectionName: 'web', host: '10.0.0.8', username: 'deploy', port: 22, healthy: true },
        ],
      }),
      isError: false,
    })
    expect(stored.args).toBe('')
    expect(stored.content).toBe('web · deploy@10.0.0.8  ok')
    const view = formatToolRunDisplay({ name: 'list_sessions', args: stored.args, content: stored.content })
    expect(view.summary).toEqual({ kind: 'sessions', count: 1 })
    expect(view.body).toBe('web · deploy@10.0.0.8  ok')
  })

  it('keeps tool runs collapsed by default', () => {
    expect(toolRunDefaultOpen()).toBe(false)
  })
})
