import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { AppSettingsChange } from '@shared/types/settings'
import { defaultWorkspaceLayout, moveWorkspaceTool } from '@shared/workspaceLayout'
const lifecycle = vi.hoisted(() => ({ mount: [] as Array<() => void>, unmount: [] as Array<() => void> }))
vi.mock('vue', async original => ({ ...await original<typeof import('vue')>(), onMounted: (fn: () => void) => lifecycle.mount.push(fn), onBeforeUnmount: (fn: () => void) => lifecycle.unmount.push(fn) }))
import { useWorkspaceLayout } from './useWorkspaceLayout'
let listener: (change: AppSettingsChange) => void
const get = vi.fn(), set = vi.fn(), unsubscribe = vi.fn()
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
beforeEach(() => {
  lifecycle.mount = []; lifecycle.unmount = []; vi.clearAllMocks()
  get.mockResolvedValue({ sshWorkspaceLayout: defaultWorkspaceLayout() })
  set.mockImplementation(async patch => ({ sshWorkspaceLayout: structuredClone(patch.sshWorkspaceLayout) }))
  vi.stubGlobal('window', { LiteConnect: { getAllSettings: get, setManySettings: set, onSettingsChanged: (fn: typeof listener) => { listener = fn; return unsubscribe } } })
})
afterEach(() => { lifecycle.unmount.forEach(fn => fn()); vi.unstubAllGlobals() })
it('persists a plain IPC payload and retains only the latest queued edit', async () => {
  const state = useWorkspaceLayout(); lifecycle.mount.forEach(fn => fn()); await settle()
  let resolve!: (value: unknown) => void
  set.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  state.update(moveWorkspaceTool(state.layout.value, 'ai', 'right'))
  state.update(moveWorkspaceTool(state.layout.value, 'files', 'right'))
  state.update(moveWorkspaceTool(state.layout.value, 'ai', 'left'))
  expect(set).toHaveBeenCalledTimes(1)
  expect(() => structuredClone(set.mock.calls[0][0])).not.toThrow()
  resolve({ sshWorkspaceLayout: moveWorkspaceTool(defaultWorkspaceLayout(), 'ai', 'right') }); await settle()
  expect(set).toHaveBeenCalledTimes(2)
  expect(state.layout.value.tools.find(tool => tool.id === 'ai')?.edge).toBe('left')
  expect(state.layout.value.tools.find(tool => tool.id === 'files')?.edge).toBe('right')
  expect(state.saving.value).toBe(false)
})
it('does not overwrite saved configuration after a failed initial read and supports retry', async () => {
  get.mockRejectedValueOnce(new Error('unavailable'))
  const state = useWorkspaceLayout(); lifecycle.mount.forEach(fn => fn()); await settle()
  state.update(defaultWorkspaceLayout())
  expect(set).not.toHaveBeenCalled(); expect(state.error.value).toBe(true)
  await state.retry(); expect(state.ready.value).toBe(true)
  set.mockRejectedValueOnce(new Error('disk full'))
  state.update(moveWorkspaceTool(state.layout.value, 'files', 'right')); await settle()
  expect(state.error.value).toBe(true)
  state.retry(); await settle(); expect(state.error.value).toBe(false)
})
it('applies another window’s layout and ignores a stale initial load', async () => {
  let resolve!: (value: unknown) => void
  get.mockImplementationOnce(() => new Promise(done => { resolve = done }))
  const state = useWorkspaceLayout(); lifecycle.mount.forEach(fn => fn())
  const remote = moveWorkspaceTool(defaultWorkspaceLayout(), 'ai', 'right')
  listener({ settings: { sshWorkspaceLayout: remote }, changed: ['sshWorkspaceLayout'] } as AppSettingsChange)
  resolve({ sshWorkspaceLayout: defaultWorkspaceLayout() }); await settle()
  expect(state.layout.value).toEqual(remote)
  expect(set).not.toHaveBeenCalled()
})
