import { createRenderer, defineComponent, nextTick, ref, type Ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MonitorData } from '../env.d'

type TestNode = { children: TestNode[]; parent?: TestNode | null; text?: string }

const renderer = createRenderer<TestNode, TestNode>({
  patchProp: () => {},
  insert: (child, parent) => {
    child.parent = parent
    parent.children.push(child)
  },
  remove: (child) => {
    const parent = child.parent
    if (parent) parent.children = parent.children.filter((node) => node !== child)
  },
  createElement: () => ({ children: [] }),
  createText: (text) => ({ children: [], text }),
  createComment: (text) => ({ children: [], text }),
  setText: (node, text) => {
    node.text = text
  },
  setElementText: (node, text) => {
    node.text = text
  },
  parentNode: (node) => node.parent ?? null,
  nextSibling: () => null,
  querySelector: () => null,
  setScopeId: () => {},
  cloneNode: (node) => ({ ...node, children: [...node.children] }),
  insertStaticContent: () => [{ children: [] }, { children: [] }],
})

async function settle() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

type MonitorApi = ReturnType<typeof import('./useMonitorData').useSharedMonitor>

async function mountMonitor(sessionId: Ref<string>) {
  const { useSharedMonitor } = await import('./useMonitorData')
  let api: MonitorApi | undefined
  const app = renderer.createApp(
    defineComponent({
      setup() {
        api = useSharedMonitor(sessionId)
        return () => null
      },
    }),
  )
  app.mount({ children: [] })
  return { app, api: api! }
}

describe('useSharedMonitor', () => {
  const originalWindow = globalThis.window
  let callbacks = new Map<string, (data: MonitorData) => void>()
  let monitorStart: ReturnType<typeof vi.fn>
  let monitorStop: ReturnType<typeof vi.fn>
  let unsubscribe: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.resetModules()
    callbacks = new Map()
    monitorStart = vi.fn(async () => {})
    monitorStop = vi.fn(async () => {})
    unsubscribe = vi.fn()
    globalThis.window = {
      LiteConnect: {
        monitorStart,
        monitorStop,
        onMonitorData: vi.fn((sessionId, callback) => {
          callbacks.set(sessionId, callback)
          return unsubscribe
        }),
      },
    } as unknown as Window & typeof globalThis
  })

  afterEach(() => {
    globalThis.window = originalWindow
  })

  it('shares one native monitor and stops it after the last consumer unmounts', async () => {
    const first = await mountMonitor(ref('session-1'))
    await settle()
    const second = await mountMonitor(ref('session-1'))
    await settle()

    expect(monitorStart).toHaveBeenCalledTimes(1)
    callbacks.get('session-1')?.({ cpu: 50 } as MonitorData)
    await nextTick()
    expect(first.api.data.value).toMatchObject({ cpu: 50 })
    expect(second.api.data.value).toMatchObject({ cpu: 50 })

    first.app.unmount()
    expect(monitorStop).not.toHaveBeenCalled()
    second.app.unmount()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(monitorStop).toHaveBeenCalledWith('session-1')
  })

  it('exposes a start failure and retry creates a fresh subscription', async () => {
    monitorStart.mockRejectedValueOnce(new Error('monitor unavailable'))
    const mounted = await mountMonitor(ref('session-2'))
    await settle()

    expect(mounted.api.error.value).toBe('monitor unavailable')
    mounted.api.retry()
    await settle()

    expect(monitorStart).toHaveBeenCalledTimes(2)
    expect(mounted.api.error.value).toBe('')
    expect(callbacks.get('session-2')).toBeTypeOf('function')
    mounted.app.unmount()
  })
})
