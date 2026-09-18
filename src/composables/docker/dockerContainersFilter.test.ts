import { describe, expect, it } from 'vitest'
import type { DockerContainerSummary } from '../../env.d'
import {
  filterContainers,
  formatContainerPortsSummary,
  inspectJsonMatches,
  matchesSearch,
  matchesStateFilter,
  resolveSelectionAfterRefresh,
} from './dockerContainersFilter'

function c(partial: Partial<DockerContainerSummary> & { id: string }): DockerContainerSummary {
  return {
    names: partial.names ?? [partial.displayName || partial.id],
    displayName: partial.displayName || partial.id,
    image: partial.image || '',
    imageId: '',
    command: '',
    created: 0,
    state: partial.state || 'unknown',
    status: partial.status || '',
    ports: partial.ports || [],
    mounts: partial.mounts || [],
    ...partial,
  }
}

describe('matchesStateFilter', () => {
  it('all matches everything', () => {
    expect(matchesStateFilter(c({ id: '1', state: 'running' }), 'all')).toBe(true)
    expect(matchesStateFilter(c({ id: '1', state: 'weird' }), 'all')).toBe(true)
  })

  it('running only matches running', () => {
    expect(matchesStateFilter(c({ id: '1', state: 'running' }), 'running')).toBe(true)
    expect(matchesStateFilter(c({ id: '1', state: 'exited' }), 'running')).toBe(false)
    expect(matchesStateFilter(c({ id: '1', state: 'created' }), 'running')).toBe(false)
  })

  it('stopped covers exited/created/dead', () => {
    expect(matchesStateFilter(c({ id: '1', state: 'exited' }), 'stopped')).toBe(true)
    expect(matchesStateFilter(c({ id: '1', state: 'created' }), 'stopped')).toBe(true)
    expect(matchesStateFilter(c({ id: '1', state: 'dead' }), 'stopped')).toBe(true)
    expect(matchesStateFilter(c({ id: '1', state: 'running' }), 'stopped')).toBe(false)
  })
})

describe('matchesSearch', () => {
  it('is case-insensitive on name and image', () => {
    const row = c({
      id: '1',
      displayName: 'Billing-API',
      names: ['Billing-API', 'bill'],
      image: 'Registry.Example/App:1',
    })
    expect(matchesSearch(row, 'billing')).toBe(true)
    expect(matchesSearch(row, 'BILL')).toBe(true)
    expect(matchesSearch(row, 'registry.example')).toBe(true)
    expect(matchesSearch(row, 'nope')).toBe(false)
  })
})

describe('filterContainers', () => {
  it('combines state and search', () => {
    const list = [
      c({ id: '1', displayName: 'web', image: 'nginx:1', state: 'running' }),
      c({ id: '2', displayName: 'db', image: 'postgres:15', state: 'exited' }),
      c({ id: '3', displayName: 'worker', image: 'app:web', state: 'running' }),
    ]
    expect(filterContainers(list, 'running', 'web').map((x) => x.id)).toEqual(['1', '3'])
    expect(filterContainers(list, 'stopped', '').map((x) => x.id)).toEqual(['2'])
  })
})

describe('resolveSelectionAfterRefresh', () => {
  it('keeps selection when id still present', () => {
    const list = [c({ id: 'a' }), c({ id: 'b' })]
    expect(resolveSelectionAfterRefresh('b', list)).toBe('b')
  })

  it('clears selection when container gone', () => {
    const list = [c({ id: 'a' })]
    expect(resolveSelectionAfterRefresh('b', list)).toBeNull()
  })
})

describe('inspectJsonMatches', () => {
  it('searches case-insensitively', () => {
    expect(inspectJsonMatches('{"Name":"MyApp"}', 'myapp')).toBe(true)
    expect(inspectJsonMatches('{"Name":"MyApp"}', 'zzz')).toBe(false)
    expect(inspectJsonMatches('{}', '')).toBe(true)
  })
})

describe('formatContainerPortsSummary', () => {
  it('formats multi ports', () => {
    expect(
      formatContainerPortsSummary([
        { ip: '0.0.0.0', privatePort: 80, publicPort: 8080, type: 'tcp' },
        { ip: '', privatePort: 443, publicPort: null, type: 'tcp' },
      ]),
    ).toContain('8080→80/tcp')
  })
})
