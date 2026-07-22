import { describe, expect, it } from 'vitest'
import {
  buildCreateContainerExecBody,
  buildCreateContainerExecPath,
  buildInspectExecPath,
  buildResizeExecPath,
  buildStartExecBody,
  buildStartExecPath,
  dockerExecShellCmd,
  isAllowedDockerApiRequest,
  isValidDockerDaemonExecId,
  isValidDockerExecShell,
  isValidDockerExecSize,
  normalizeCreateExecResponse,
  normalizeExecInspect,
} from './containers'

describe('exec path builders and whitelist', () => {
  it('builds create exec path and fixed body for bash/sh', () => {
    expect(buildCreateContainerExecPath('abc123')).toBe('/containers/abc123/exec')
    expect(JSON.parse(buildCreateContainerExecBody('bash'))).toEqual({
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Privileged: false,
      Cmd: ['/bin/bash'],
    })
    expect(JSON.parse(buildCreateContainerExecBody('sh'))).toEqual({
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      Tty: true,
      Privileged: false,
      Cmd: ['/bin/sh'],
    })
    const bashBody = JSON.parse(buildCreateContainerExecBody('bash'))
    expect(bashBody.User).toBeUndefined()
    expect(bashBody.Env).toBeUndefined()
    expect(bashBody.WorkingDir).toBeUndefined()
    expect(bashBody.DetachKeys).toBeUndefined()
  })

  it('builds start/resize/inspect paths with fixed query order', () => {
    const execId = 'a1b2c3d4e5f67890'
    expect(buildStartExecPath(execId)).toBe(`/exec/${execId}/start`)
    expect(JSON.parse(buildStartExecBody())).toEqual({ Detach: false, Tty: true })
    expect(buildResizeExecPath(execId, 24, 80)).toBe(`/exec/${execId}/resize?h=24&w=80`)
    expect(buildInspectExecPath(execId)).toBe(`/exec/${execId}/json`)
  })

  it('rejects invalid sizes and exec ids', () => {
    expect(isValidDockerExecSize(0)).toBe(false)
    expect(isValidDockerExecSize(1001)).toBe(false)
    expect(isValidDockerExecSize(1.5)).toBe(false)
    expect(isValidDockerExecSize(80)).toBe(true)
    expect(isValidDockerDaemonExecId('../x')).toBe(false)
    expect(isValidDockerDaemonExecId('short')).toBe(false)
    expect(isValidDockerDaemonExecId('a1b2c3d4')).toBe(true)
    expect(() => buildResizeExecPath('bad', 24, 80)).toThrow()
    expect(() => buildResizeExecPath('a1b2c3d4e5f67890', 0, 80)).toThrow()
  })

  it('allows only fixed method+path pairs for exec', () => {
    const id = 'abc123'
    const execId = 'a1b2c3d4e5f67890'
    expect(isAllowedDockerApiRequest('POST', `/containers/${id}/exec`)).toBe(true)
    expect(isAllowedDockerApiRequest('GET', `/containers/${id}/exec`)).toBe(false)
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/start`)).toBe(true)
    expect(isAllowedDockerApiRequest('GET', `/exec/${execId}/start`)).toBe(false)
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/resize?h=24&w=80`)).toBe(true)
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/resize?w=80&h=24`)).toBe(false)
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/resize?h=24&w=80&extra=1`)).toBe(
      false,
    )
    expect(isAllowedDockerApiRequest('GET', `/exec/${execId}/json`)).toBe(true)
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/json`)).toBe(false)
    expect(isAllowedDockerApiRequest('POST', `/containers/${id}/kill`)).toBe(false)
    expect(isAllowedDockerApiRequest('POST', `/containers/${id}/stop`)).toBe(false)
    expect(isAllowedDockerApiRequest('DELETE', `/containers/${id}`)).toBe(false)
    expect(isAllowedDockerApiRequest('POST', `/exec/../${execId}/start`)).toBe(false)
  })

  it('shell enum only maps to absolute paths', () => {
    expect(isValidDockerExecShell('bash')).toBe(true)
    expect(isValidDockerExecShell('sh')).toBe(true)
    expect(isValidDockerExecShell('/bin/bash')).toBe(false)
    expect(isValidDockerExecShell('zsh')).toBe(false)
    expect(dockerExecShellCmd('bash')).toEqual(['/bin/bash'])
    expect(dockerExecShellCmd('sh')).toEqual(['/bin/sh'])
  })

  it('normalizes create/inspect responses without extra fields', () => {
    expect(normalizeCreateExecResponse({ Id: 'a1b2c3d4e5f67890' })).toBe('a1b2c3d4e5f67890')
    expect(() => normalizeCreateExecResponse({ Id: '../x' })).toThrow()
    expect(normalizeExecInspect({ Running: false, ExitCode: 0 })).toEqual({
      running: false,
      exitCode: 0,
    })
    expect(normalizeExecInspect({ Running: true, ExitCode: 137 })).toEqual({
      running: true,
      exitCode: 137,
    })
    expect(normalizeExecInspect(null)).toEqual({ running: false, exitCode: null })
  })

  it('tightened exec-id whitelist rejects %, uppercase, overlong, short', () => {
    const good = 'a1b2c3d4e5f67890'
    // %2f traversal attempt
    expect(isAllowedDockerApiRequest('POST', `/exec/%2f/start`)).toBe(false)
    expect(isAllowedDockerApiRequest('GET', `/exec/%2f/json`)).toBe(false)
    // uppercase hex
    expect(isAllowedDockerApiRequest('POST', `/exec/A1B2C3D4E5F67890/start`)).toBe(false)
    // over 64 chars
    const over = 'a'.repeat(65)
    expect(isAllowedDockerApiRequest('POST', `/exec/${over}/start`)).toBe(false)
    expect(isAllowedDockerApiRequest('GET', `/exec/${over}/json`)).toBe(false)
    // under 8 chars
    expect(isAllowedDockerApiRequest('POST', `/exec/abcdef/start`)).toBe(false)
    // builder-produced good id still allowed
    expect(isAllowedDockerApiRequest('POST', `/exec/${good}/start`)).toBe(true)
    expect(isAllowedDockerApiRequest('GET', `/exec/${good}/json`)).toBe(true)
  })

  it('tightened resize whitelist rejects 0, 1001, leading zeros, swapped order, extra query', () => {
    const execId = 'a1b2c3d4e5f67890'
    // boundary 1 and 1000 pass
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/resize?h=1&w=1`)).toBe(true)
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/resize?h=1000&w=1000`)).toBe(true)
    // 0 rejected
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/resize?h=0&w=80`)).toBe(false)
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/resize?h=24&w=0`)).toBe(false)
    // 1001 / 9999 rejected
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/resize?h=1001&w=80`)).toBe(false)
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/resize?h=24&w=9999`)).toBe(false)
    // leading zeros rejected
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/resize?h=024&w=080`)).toBe(false)
    // swapped order rejected
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/resize?w=80&h=24`)).toBe(false)
    // extra query rejected
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/resize?h=24&w=80&extra=1`)).toBe(
      false,
    )
    // 4-digit 1000 boundary: 1001 rejected, 1000 accepted (already above)
    expect(isAllowedDockerApiRequest('POST', `/exec/${execId}/resize?h=1000&w=1001`)).toBe(false)
  })

  it('create-exec container segment rejects encoded slash/traversal/space, keeps valid', () => {
    // valid id
    expect(isAllowedDockerApiRequest('POST', `/containers/abc123/exec`)).toBe(true)
    expect(isAllowedDockerApiRequest('POST', `/containers/my-app_1/exec`)).toBe(true)
    // %2f encoded slash
    expect(isAllowedDockerApiRequest('POST', `/containers/abc%2f123/exec`)).toBe(false)
    // %2e%2e traversal
    expect(isAllowedDockerApiRequest('POST', `/containers/%2e%2e/exec`)).toBe(false)
    expect(isAllowedDockerApiRequest('POST', `/containers/..%2f/exec`)).toBe(false)
    // over 128 chars
    const long = 'a'.repeat(129)
    expect(isAllowedDockerApiRequest('POST', `/containers/${long}/exec`)).toBe(false)
    // space
    expect(isAllowedDockerApiRequest('POST', `/containers/has space/exec`)).toBe(false)
  })

  it('create-exec container segment aligns with DOCKER_CONTAINER_ID_RE first-char + length rules', () => {
    // Leading '.', '_', '-' rejected (validator requires first char alnum)
    expect(isAllowedDockerApiRequest('POST', `/containers/./exec`)).toBe(false)
    expect(isAllowedDockerApiRequest('POST', `/containers/../exec`)).toBe(false)
    expect(isAllowedDockerApiRequest('POST', `/containers/.name/exec`)).toBe(false)
    expect(isAllowedDockerApiRequest('POST', `/containers/-name/exec`)).toBe(false)
    expect(isAllowedDockerApiRequest('POST', `/containers/_name/exec`)).toBe(false)
    // Empty segment rejected
    expect(isAllowedDockerApiRequest('POST', `/containers//exec`)).toBe(false)

    // Boundary: single alnum passes
    expect(isAllowedDockerApiRequest('POST', `/containers/a/exec`)).toBe(true)
    expect(isAllowedDockerApiRequest('POST', `/containers/0/exec`)).toBe(true)
    // Boundary: exactly 128 chars, first char alnum, passes
    const exact = 'a' + 'b'.repeat(127)
    expect(exact.length).toBe(128)
    expect(isAllowedDockerApiRequest('POST', `/containers/${exact}/exec`)).toBe(true)
    // Boundary: 129 chars rejected
    const tooLong = 'a' + 'b'.repeat(128)
    expect(isAllowedDockerApiRequest('POST', `/containers/${tooLong}/exec`)).toBe(false)
    // First char '.' even if length ok -> rejected
    expect(isAllowedDockerApiRequest('POST', `/containers/${'.' + 'a'.repeat(127)}/exec`)).toBe(
      false,
    )
  })
})
