import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import {
  canApplyContainersListResult,
  canApplyInspectResult,
  useDockerContainers,
} from './useDockerContainers'
import type { DockerContainerInspectResult, DockerContainerSummary } from '../../env.d'

function sample(id: string, name: string, state = 'running'): DockerContainerSummary {
  return {
    id,
    names: [name],
    displayName: name,
    image: `img/${name}`,
    imageId: '',
    command: '',
    created: 1,
    state,
    status: state === 'running' ? 'Up' : 'Exited',
    ports: [],
    mounts: [],
  }
}

function sampleInspect(id: string, name: string): DockerContainerInspectResult {
  return {
    overview: {
      id,
      name: `/${name}`,
      displayName: name,
      image: `img/${name}`,
      imageId: '',
      created: '',
      path: '',
      args: [],
      state: {
        status: 'running',
        running: true,
        paused: false,
        restarting: false,
        startedAt: '',
        finishedAt: '',
        exitCode: 0,
        error: '',
      },
      ports: [],
      mounts: [],
      networks: [],
      restartPolicy: 'no',
    },
    inspectJson: JSON.stringify({ Id: id, Name: `/${name}` }, null, 2),
  }
}

function mockliteConnect(opts: {
  list?: (sessionId: string) => Promise<DockerContainerSummary[]>
  inspect?: (sessionId: string, containerId: string) => Promise<DockerContainerInspectResult>
}) {
  const g = globalThis as typeof globalThis & {
    window: {
      LiteConnect: {
        dockerListContainers: (sessionId: string) => Promise<DockerContainerSummary[]>
        dockerInspectContainer: (
          sessionId: string,
          containerId: string,
        ) => Promise<DockerContainerInspectResult>
      }
    }
  }
  g.window = g.window || ({} as typeof g.window)
  g.window.LiteConnect = {
    dockerListContainers: opts.list || (async () => []),
    dockerInspectContainer: opts.inspect || (async (_s, id) => sampleInspect(id, id)),
  }
}

describe('canApplyContainersListResult / canApplyInspectResult', () => {
  it('rejects stale list generations and sessions', () => {
    expect(
      canApplyContainersListResult({
        disposed: false,
        resultGen: 1,
        currentGen: 2,
        ownerSessionId: 'a',
        resultSessionId: 'a',
        activeSessionId: 'a',
      }),
    ).toBe(false)
    expect(
      canApplyContainersListResult({
        disposed: false,
        resultGen: 2,
        currentGen: 2,
        ownerSessionId: 'a',
        resultSessionId: 'a',
        activeSessionId: 'a',
      }),
    ).toBe(true)
  })

  it('rejects inspect when selection changed', () => {
    expect(
      canApplyInspectResult({
        disposed: false,
        resultGen: 1,
        currentGen: 1,
        ownerSessionId: 's',
        resultSessionId: 's',
        activeSessionId: 's',
        selectedId: 'b',
        resultContainerId: 'a',
      }),
    ).toBe(false)
  })
})

describe('useDockerContainers', () => {
  let scope: ReturnType<typeof effectScope>

  beforeEach(() => {
    scope = effectScope()
  })

  afterEach(() => {
    scope.stop()
  })

  it('refresh keeps old list until new result arrives and is awaitable', async () => {
    let resolveSecond: (v: DockerContainerSummary[]) => void
    const second = new Promise<DockerContainerSummary[]>((r) => {
      resolveSecond = r
    })
    let call = 0
    mockliteConnect({
      list: async () => {
        call += 1
        if (call === 1) return [sample('1', 'first')]
        return second
      },
    })

    const sessionId = ref<string | null>('s1')
    const api = scope.run(() => useDockerContainers(sessionId))!
    await api.loadList()
    await nextTick()
    expect(api.containers.value).toHaveLength(1)
    expect(api.containers.value[0].displayName).toBe('first')

    const refreshDone = api.refresh()
    await Promise.resolve()
    await nextTick()
    // still old list while refreshing
    expect(api.containers.value[0].displayName).toBe('first')
    expect(api.refreshing.value).toBe(true)

    resolveSecond!([sample('2', 'second')])
    await refreshDone
    await nextTick()
    expect(api.containers.value[0].displayName).toBe('second')
    expect(api.refreshing.value).toBe(false)
  })

  it('discards late list from previous session', async () => {
    let resolveA: (v: DockerContainerSummary[]) => void
    const listA = new Promise<DockerContainerSummary[]>((r) => {
      resolveA = r
    })
    mockliteConnect({
      list: async (sid) => {
        if (sid === 'sess-a') return listA
        return [sample('b', 'from-b')]
      },
    })

    const sessionId = ref<string | null>('sess-a')
    const api = scope.run(() => useDockerContainers(sessionId))!
    void api.loadList()
    await nextTick()

    sessionId.value = 'sess-b'
    await nextTick()
    await api.loadList()
    await nextTick()
    expect(api.containers.value[0]?.displayName).toBe('from-b')

    resolveA!([sample('a', 'late-a')])
    await Promise.resolve()
    await nextTick()
    expect(api.containers.value[0]?.displayName).toBe('from-b')
  })

  it('discards late list from older refresh generation', async () => {
    let resolveFirst: (v: DockerContainerSummary[]) => void
    const first = new Promise<DockerContainerSummary[]>((r) => {
      resolveFirst = r
    })
    let call = 0
    mockliteConnect({
      list: async () => {
        call += 1
        if (call === 1) return first
        return [sample('2', 'newer')]
      },
    })

    const sessionId = ref<string | null>('s1')
    const api = scope.run(() => useDockerContainers(sessionId))!
    void api.loadList()
    await nextTick()
    // second load
    await api.loadList()
    await nextTick()
    expect(api.containers.value[0]?.displayName).toBe('newer')

    resolveFirst!([sample('1', 'stale')])
    await Promise.resolve()
    await nextTick()
    expect(api.containers.value[0]?.displayName).toBe('newer')
  })

  it('keeps selection by id after refresh', async () => {
    mockliteConnect({
      list: async () => [sample('keep', 'alpha'), sample('other', 'beta')],
      inspect: async (_s, id) => sampleInspect(id, id),
    })
    const sessionId = ref<string | null>('s1')
    const api = scope.run(() => useDockerContainers(sessionId))!
    await api.loadList()
    await api.selectContainer('keep')
    await nextTick()
    expect(api.selectedId.value).toBe('keep')

    await api.loadList({ keepExisting: true })
    await nextTick()
    expect(api.selectedId.value).toBe('keep')
  })

  it('clears selection when container disappears', async () => {
    let call = 0
    mockliteConnect({
      list: async () => {
        call += 1
        if (call === 1) return [sample('gone', 'x'), sample('stay', 'y')]
        return [sample('stay', 'y')]
      },
      inspect: async (_s, id) => sampleInspect(id, id),
    })
    const sessionId = ref<string | null>('s1')
    const api = scope.run(() => useDockerContainers(sessionId))!
    await api.loadList()
    await api.selectContainer('gone')
    await nextTick()
    expect(api.selectedId.value).toBe('gone')

    await api.loadList({ keepExisting: true })
    await nextTick()
    expect(api.selectedId.value).toBeNull()
  })

  it('inspect A late result does not overwrite B', async () => {
    let resolveA: (v: DockerContainerInspectResult) => void
    const inspA = new Promise<DockerContainerInspectResult>((r) => {
      resolveA = r
    })
    mockliteConnect({
      list: async () => [sample('a', 'A'), sample('b', 'B')],
      inspect: async (_s, id) => {
        if (id === 'a') return inspA
        return sampleInspect('b', 'B')
      },
    })
    const sessionId = ref<string | null>('s1')
    const api = scope.run(() => useDockerContainers(sessionId))!
    await api.loadList()
    void api.selectContainer('a')
    await nextTick()
    await api.selectContainer('b')
    await nextTick()
    await Promise.resolve()
    await nextTick()
    expect(api.inspectResult.value?.overview.displayName).toBe('B')

    resolveA!(sampleInspect('a', 'A-late'))
    await Promise.resolve()
    await nextTick()
    expect(api.inspectResult.value?.overview.displayName).toBe('B')
  })

  it('filters all/running/stopped and search without extra list requests', async () => {
    const listFn = vi.fn(async () => [
      sample('1', 'Web', 'running'),
      sample('2', 'Db', 'exited'),
    ])
    mockliteConnect({ list: listFn })
    const sessionId = ref<string | null>('s1')
    const api = scope.run(() => useDockerContainers(sessionId))!
    await api.loadList()
    expect(listFn).toHaveBeenCalledTimes(1)

    api.setStateFilter('running')
    expect(api.filteredContainers.value.map((x) => x.id)).toEqual(['1'])
    api.setStateFilter('stopped')
    expect(api.filteredContainers.value.map((x) => x.id)).toEqual(['2'])
    api.setStateFilter('all')
    api.setSearchQuery('web')
    expect(api.filteredContainers.value.map((x) => x.id)).toEqual(['1'])
    expect(listFn).toHaveBeenCalledTimes(1)
  })
})
