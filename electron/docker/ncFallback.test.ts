import { describe, expect, it } from 'vitest'
import {
  classifyNcExecFailure,
  DOCKER_NC_EXEC_COMMAND,
  DOCKER_NC_STDERR_CLASSIFY_MAX,
  shouldFallbackToNcExec,
  truncateNcStderr,
} from './ncFallback'
import { DockerTransportError } from './types'

describe('DOCKER_NC_EXEC_COMMAND', () => {
  it('is fixed absolute nc client, no listen/sudo/pty tokens', () => {
    expect(DOCKER_NC_EXEC_COMMAND).toBe('exec /usr/bin/nc -U /var/run/docker.sock')
    expect(DOCKER_NC_EXEC_COMMAND).toMatch(/^exec \/usr\/bin\/nc -U \/var\/run\/docker\.sock$/)
    expect(DOCKER_NC_EXEC_COMMAND).not.toMatch(/-l\b|sudo|pty|bash -c|sh -c/)
  })
})

describe('shouldFallbackToNcExec', () => {
  it('allows transport-unsupported and socket-forward-failed', () => {
    expect(
      shouldFallbackToNcExec(
        new DockerTransportError('transport-unsupported', 'no streamlocal', 's'),
      ),
    ).toBe(true)
    expect(
      shouldFallbackToNcExec(
        new DockerTransportError('socket-forward-failed', 'open failed', 's'),
      ),
    ).toBe(true)
  })

  it('allows administratively prohibited, channel open failure, and StreamLocal hang timeout', () => {
    expect(shouldFallbackToNcExec(new Error('Administratively prohibited'))).toBe(true)
    expect(shouldFallbackToNcExec(new Error('channel open failed: administratively prohibited'))).toBe(
      true,
    )
    expect(shouldFallbackToNcExec(new Error('Channel open failure: open failed'))).toBe(true)
    expect(
      shouldFallbackToNcExec(new Error('openssh_forwardOutStreamLocal is not supported')),
    ).toBe(true)
    expect(shouldFallbackToNcExec(new Error('StreamLocal open timed out'))).toBe(true)
  })

  it('forbids session death, permission, socket missing, auth', () => {
    expect(
      shouldFallbackToNcExec(new DockerTransportError('ssh-disconnected', 'gone', 's')),
    ).toBe(false)
    expect(
      shouldFallbackToNcExec(new DockerTransportError('permission-denied', 'no', 's')),
    ).toBe(false)
    expect(
      shouldFallbackToNcExec(new DockerTransportError('socket-not-found', 'no sock', 's')),
    ).toBe(false)
    expect(shouldFallbackToNcExec(Object.assign(new Error('Permission denied'), { code: 'EACCES' }))).toBe(
      false,
    )
    expect(shouldFallbackToNcExec(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))).toBe(false)
    expect(shouldFallbackToNcExec(new Error('SSH session generation changed'))).toBe(false)
    expect(shouldFallbackToNcExec(new Error('SSH session not connected'))).toBe(false)
  })
})

describe('classifyNcExecFailure', () => {
  it('maps nc missing / -U unsupported to transport-unsupported without stderr leak', () => {
    const e = classifyNcExecFailure({ exitCode: 127, stderrSnippet: 'bash: /usr/bin/nc: No such file' }, 's1')
    expect(e.code).toBe('transport-unsupported')
    expect(e.message).not.toMatch(/bash:|No such file/)
    expect(e.sessionId).toBe('s1')

    const e2 = classifyNcExecFailure({
      exitCode: 1,
      stderrSnippet: 'nc: invalid option -- U\nusage: nc [-options]',
    })
    expect(e2.code).toBe('transport-unsupported')
    expect(e2.message).not.toMatch(/invalid option|usage:/)
  })

  it('maps socket missing and permission without stderr in message', () => {
    const e = classifyNcExecFailure({
      exitCode: 1,
      stderrSnippet: 'nc: connect to /var/run/docker.sock failed: No such file or directory',
    })
    expect(e.code).toBe('socket-not-found')
    expect(e.message).toBe('Docker socket not found')

    const e2 = classifyNcExecFailure({
      exitCode: 1,
      stderrSnippet: 'nc: Permission denied connecting to docker.sock',
    })
    expect(e2.code).toBe('permission-denied')
    expect(e2.message).toBe('Permission denied for Docker socket')
  })

  it('maps early close and open errors to stable codes', () => {
    expect(classifyNcExecFailure({ earlyClose: true }).code).toBe('proxy-closed')
    expect(
      classifyNcExecFailure({ openError: new Error('SSH session not connected') }).code,
    ).toBe('ssh-disconnected')
    expect(
      classifyNcExecFailure({ openError: new Error('SSH session generation changed') }).code,
    ).toBe('generation-stale')
    expect(
      classifyNcExecFailure({ openError: new Error('exec failed weirdly') }).code,
    ).toBe('socket-forward-failed')
  })
})

describe('truncateNcStderr', () => {
  it('hard-caps internal stderr for classify', () => {
    const big = 'x'.repeat(DOCKER_NC_STDERR_CLASSIFY_MAX + 50)
    expect(truncateNcStderr(big).length).toBe(DOCKER_NC_STDERR_CLASSIFY_MAX)
  })
})
