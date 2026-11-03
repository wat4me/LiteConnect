import { expect, it } from 'vitest'
import { defaultWorkspaceLayout, moveWorkspaceTool, normalizeWorkspaceLayout, WORKSPACE_TOOLS, workspacePanelEdge } from './workspaceLayout'

it('preserves the original rail order and default panel destinations', () => {
  const layout = defaultWorkspaceLayout()
  expect(layout.tools.map(tool => tool.id)).toEqual([...WORKSPACE_TOOLS])
  expect(layout.tools.every(tool => tool.edge === 'left')).toBe(true)
  expect(workspacePanelEdge(layout, 'monitor')).toBe('bottom')
  expect(workspacePanelEdge(layout, 'batch')).toBe('right')
})
it('repairs corrupt or incomplete persisted layouts without losing built-in tools', () => {
  const layout = normalizeWorkspaceLayout({ version: 1, locked: 'yes', tools: [null, { id: 'ai', edge: 'right', panelEdge: 'right' }, { id: 'ai', edge: 'top' }, { id: '../../untrusted' }, { id: 'files', edge: 'invalid' }], sizes: { left: Infinity, right: 9999, top: -2, bottom: '300' } })
  expect(layout.tools).toHaveLength(WORKSPACE_TOOLS.length)
  expect(new Set(layout.tools.map(tool => tool.id)).size).toBe(WORKSPACE_TOOLS.length)
  expect(layout.tools[0]).toEqual({ id: 'ai', edge: 'right', panelEdge: 'right' })
  expect(layout.sizes).toEqual({ left: 360, right: 720, top: 120, bottom: 240 })
  expect(layout.locked).toBe(false)
  expect(normalizeWorkspaceLayout({ version: 99 })).toEqual(defaultWorkspaceLayout())
})
it('moves tools and their panels together, preserving component IDs and other placements', () => {
  const original = defaultWorkspaceLayout(), changed = moveWorkspaceTool(original, 'ai', 'bottom')
  expect(changed.tools.find(tool => tool.id === 'ai')).toEqual({ id: 'ai', edge: 'bottom', panelEdge: 'bottom' })
  expect(original.tools[0].edge).toBe('left')
  expect(changed.tools.filter(tool => tool.id !== 'ai')).toEqual(original.tools.filter(tool => tool.id !== 'ai'))
  expect(moveWorkspaceTool({ ...changed, locked: true }, 'ai', 'left').tools).toEqual(changed.tools)
})
it('reorders existing icons without changing legacy panel destinations', () => {
  const original = defaultWorkspaceLayout(), reordered = moveWorkspaceTool(original, 'batch', 'left', 'ai')
  expect(reordered.tools[0].id).toBe('batch')
  expect(workspacePanelEdge(reordered, 'batch')).toBe('right')
  const explicit = moveWorkspaceTool(reordered, 'batch', 'left', undefined, true)
  expect(workspacePanelEdge(explicit, 'batch')).toBe('left')
})
