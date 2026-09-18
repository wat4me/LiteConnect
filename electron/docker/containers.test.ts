import { describe, expect, it } from 'vitest'
import {
  buildContainerActionPath,
  buildInspectContainerPath,
  buildRestartContainerPath,
  buildStartContainerPath,
  buildStopContainerPath,
  formatPortsSummary,
  isAllowedDockerApiPath,
  isAllowedDockerApiRequest,
  isValidDockerContainerAction,
  isValidDockerContainerId,
  normalizeContainerInspect,
  normalizeContainerList,
  normalizeContainerNames,
  normalizeContainerSummary,
} from './containers'
import { DOCKER_STOP_TIMEOUT_SEC } from './types'

describe('isValidDockerContainerId', () => {
  it('accepts hex ids and names', () => {
    expect(isValidDockerContainerId('a1b2c3d4e5f6')).toBe(true)
    expect(isValidDockerContainerId('my-app_1')).toBe(true)
    expect(isValidDockerContainerId('web.server')).toBe(true)
  })

  it('rejects empty, path, spaces, overlong', () => {
    expect(isValidDockerContainerId('')).toBe(false)
    expect(isValidDockerContainerId('/containers/x/json')).toBe(false)
    expect(isValidDockerContainerId('a/b')).toBe(false)
    expect(isValidDockerContainerId('has space')).toBe(false)
    expect(isValidDockerContainerId('../x')).toBe(false)
    expect(isValidDockerContainerId('x'.repeat(129))).toBe(false)
    expect(isValidDockerContainerId(null)).toBe(false)
  })
})

describe('buildInspectContainerPath', () => {
  it('builds fixed path with encoding', () => {
    expect(buildInspectContainerPath('abc123')).toBe('/containers/abc123/json')
    expect(buildInspectContainerPath('my-app')).toBe('/containers/my-app/json')
  })

  it('throws on invalid id', () => {
    expect(() => buildInspectContainerPath('../etc')).toThrow('Invalid container id')
  })
})

describe('buildContainerActionPath', () => {
  it('builds start/stop/restart with fixed timeout', () => {
    expect(buildStartContainerPath('abc123')).toBe('/containers/abc123/start')
    expect(buildStopContainerPath('abc123')).toBe(
      `/containers/abc123/stop?t=${DOCKER_STOP_TIMEOUT_SEC}`,
    )
    expect(buildRestartContainerPath('abc123')).toBe(
      `/containers/abc123/restart?t=${DOCKER_STOP_TIMEOUT_SEC}`,
    )
    expect(buildContainerActionPath('start', 'my-app')).toBe('/containers/my-app/start')
  })

  it('throws on invalid id', () => {
    expect(() => buildStartContainerPath('../etc')).toThrow('Invalid container id')
  })
})

describe('isValidDockerContainerAction', () => {
  it('only allows start|stop|restart', () => {
    expect(isValidDockerContainerAction('start')).toBe(true)
    expect(isValidDockerContainerAction('stop')).toBe(true)
    expect(isValidDockerContainerAction('restart')).toBe(true)
    expect(isValidDockerContainerAction('kill')).toBe(false)
    expect(isValidDockerContainerAction('delete')).toBe(false)
  })
})

describe('isAllowedDockerApiPath / isAllowedDockerApiRequest', () => {
  it('allows ping, version, list, inspect, actions, logs, exec', () => {
    expect(isAllowedDockerApiPath('/_ping')).toBe(true)
    expect(isAllowedDockerApiPath('/version')).toBe(true)
    expect(isAllowedDockerApiPath('/containers/json?all=true')).toBe(true)
    expect(isAllowedDockerApiPath('/containers/abc123/json')).toBe(true)
    expect(isAllowedDockerApiPath('/containers/abc123/start')).toBe(true)
    expect(
      isAllowedDockerApiPath(`/containers/abc123/stop?t=${DOCKER_STOP_TIMEOUT_SEC}`),
    ).toBe(true)
    expect(
      isAllowedDockerApiPath(
        '/containers/abc123/logs?stdout=1&stderr=1&timestamps=0&tail=200&follow=1',
      ),
    ).toBe(true)
    expect(isAllowedDockerApiPath('/containers/abc123/exec')).toBe(true)
    expect(isAllowedDockerApiPath('/exec/a1b2c3d4e5f67890/start')).toBe(true)
    expect(isAllowedDockerApiPath('/exec/a1b2c3d4e5f67890/resize?h=24&w=80')).toBe(true)
    expect(isAllowedDockerApiPath('/exec/a1b2c3d4e5f67890/json')).toBe(true)
  })

  it('enforces method+path pairs', () => {
    expect(isAllowedDockerApiRequest('GET', '/containers/abc/start')).toBe(false)
    expect(isAllowedDockerApiRequest('POST', '/containers/abc/json')).toBe(false)
    expect(isAllowedDockerApiRequest('POST', '/containers/abc/stop?t=1')).toBe(false)
  })

  it('blocks arbitrary paths', () => {
    expect(isAllowedDockerApiPath('/containers/json')).toBe(false)
    expect(isAllowedDockerApiPath('/images/json')).toBe(false)
    expect(isAllowedDockerApiPath('/containers/../version')).toBe(false)
    expect(isAllowedDockerApiPath('containers/x/json')).toBe(false)
  })
})

describe('normalizeContainerNames', () => {
  it('strips leading slash and picks displayName', () => {
    expect(normalizeContainerNames(['/web', '/web-alias'])).toEqual({
      names: ['web', 'web-alias'],
      displayName: 'web',
    })
  })

  it('handles empty', () => {
    expect(normalizeContainerNames([])).toEqual({ names: [], displayName: '' })
    expect(normalizeContainerNames(null)).toEqual({ names: [], displayName: '' })
  })
})

describe('normalizeContainerList', () => {
  it('normalizes 0 containers', () => {
    expect(normalizeContainerList([])).toEqual([])
  })

  it('normalizes 1 container with real name and no ports', () => {
    const list = normalizeContainerList([
      {
        Id: 'fullid1234567890',
        Names: ['/real-remote-name'],
        Image: 'registry.example/app:1.2',
        ImageID: 'sha256:abc',
        Command: 'nginx -g daemon off;',
        Created: 1700000000,
        State: 'running',
        Status: 'Up 2 hours',
        Ports: [],
        Mounts: [],
      },
    ])
    expect(list).toHaveLength(1)
    expect(list[0].displayName).toBe('real-remote-name')
    expect(list[0].names).toEqual(['real-remote-name'])
    expect(list[0].image).toBe('registry.example/app:1.2')
    expect(list[0].ports).toEqual([])
    expect(list[0].state).toBe('running')
  })

  it('normalizes multi ports and mounts', () => {
    const list = normalizeContainerList([
      {
        Id: 'id1',
        Names: ['/svc'],
        Image: 'img',
        ImageID: 'sha256:x',
        Command: 'cmd',
        Created: 1,
        State: 'exited',
        Status: 'Exited (0)',
        Ports: [
          { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
          { PrivatePort: 443, Type: 'tcp' },
        ],
        Mounts: [
          {
            Type: 'bind',
            Source: '/host/data',
            Destination: '/data',
            Mode: 'rw',
            RW: true,
          },
          {
            Type: 'volume',
            Name: 'vol1',
            Source: '/var/lib/docker/volumes/vol1',
            Destination: '/var',
            Mode: 'ro',
            RW: false,
          },
        ],
      },
    ])
    expect(list[0].ports).toHaveLength(2)
    expect(list[0].ports[0].publicPort).toBe(8080)
    expect(list[0].ports[1].publicPort).toBeNull()
    expect(list[0].mounts).toHaveLength(2)
    expect(list[0].mounts[0].destination).toBe('/data')
  })

  it('skips junk entries and missing Id', () => {
    const list = normalizeContainerList([
      null,
      { Names: ['/x'] },
      { Id: 'ok', Names: ['/ok'], Image: 'i', State: 'running' },
    ])
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('ok')
  })

  it('handles many containers', () => {
    const raw = Array.from({ length: 100 }, (_, i) => ({
      Id: `id${i}`,
      Names: [`/c-${i}`],
      Image: `img:${i}`,
      State: i % 2 === 0 ? 'running' : 'exited',
      Status: 'x',
      Created: i,
    }))
    const list = normalizeContainerList(raw)
    expect(list).toHaveLength(100)
    expect(list[0].displayName).toBe('c-0')
    expect(list[99].displayName).toBe('c-99')
  })

  it('returns empty for non-array body', () => {
    expect(normalizeContainerList(null)).toEqual([])
    expect(normalizeContainerList({})).toEqual([])
  })
})

describe('normalizeContainerSummary fallback displayName', () => {
  it('uses id prefix when names empty', () => {
    const s = normalizeContainerSummary({
      Id: 'abcdef1234567890',
      Names: [],
      Image: 'x',
      State: 'created',
    })
    expect(s?.displayName).toBe('abcdef123456')
  })
})

describe('formatPortsSummary', () => {
  it('formats published and private-only', () => {
    expect(
      formatPortsSummary([
        { ip: '0.0.0.0', privatePort: 80, publicPort: 8080, type: 'tcp' },
        { ip: '', privatePort: 443, publicPort: null, type: 'tcp' },
      ]),
    ).toBe('8080→80/tcp, 443/tcp')
  })
})

describe('normalizeContainerInspect', () => {
  it('builds overview and pretty json without requiring labels', () => {
    const raw = {
      Id: 'full-id-xyz',
      Name: '/prod-api',
      Image: 'sha256:img',
      Created: '2024-01-01T00:00:00Z',
      Path: 'nginx',
      Args: ['-g', 'daemon off;'],
      State: {
        Status: 'running',
        Running: true,
        Paused: false,
        Restarting: false,
        StartedAt: '2024-01-02T00:00:00Z',
        FinishedAt: '0001-01-01T00:00:00Z',
        ExitCode: 0,
        Error: '',
      },
      Config: { Image: 'nginx:1.25' },
      HostConfig: { RestartPolicy: { Name: 'unless-stopped' } },
      NetworkSettings: {
        Networks: { bridge: {}, custom_net: {} },
        Ports: {
          '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '8080' }],
          '443/tcp': null,
        },
      },
      Mounts: [
        {
          Type: 'bind',
          Source: '/etc/app',
          Destination: '/app',
          Mode: 'ro',
          RW: false,
        },
      ],
    }
    const r = normalizeContainerInspect(raw)
    expect(r.overview.displayName).toBe('prod-api')
    expect(r.overview.image).toBe('nginx:1.25')
    expect(r.overview.state.running).toBe(true)
    expect(r.overview.networks).toEqual(['bridge', 'custom_net'])
    expect(r.overview.ports.some((p) => p.publicPort === 8080)).toBe(true)
    expect(r.overview.mounts).toHaveLength(1)
    expect(r.overview.restartPolicy).toBe('unless-stopped')
    expect(r.inspectJson).toContain('prod-api')
    expect(r.inspectJson).toContain('\n')
  })

  it('throws on invalid payload', () => {
    expect(() => normalizeContainerInspect(null)).toThrow()
    expect(() => normalizeContainerInspect({})).toThrow()
  })
})
