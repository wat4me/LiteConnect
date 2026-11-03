import { effectScope, ref } from 'vue'
import { expect, it } from 'vitest'
import { defaultWorkspaceLayout, moveWorkspaceTool, type WorkspacePanel } from '@shared/workspaceLayout'
import { useWorkspacePanelPolicy } from './useWorkspacePanelPolicy'

it('allows different regions concurrently, resolves collisions and honors programmatic opens', () => {
  const scope = effectScope(), layout = ref(defaultWorkspaceLayout()), single = ref(false)
  const panels = Object.fromEntries(['ai', 'files', 'monitor', 'batch', 'sync', 'snippets'].map(id => [id, ref(false)])) as Record<WorkspacePanel, ReturnType<typeof ref<boolean>>>
  scope.run(() => useWorkspacePanelPolicy(layout, panels, single))
  try {
    panels.ai.value = true; panels.files.value = true
    expect(panels.ai.value).toBe(false)
    layout.value = moveWorkspaceTool(layout.value, 'ai', 'right')
    panels.ai.value = true
    expect(panels.files.value).toBe(true)
    expect(panels.ai.value).toBe(true)
    panels.batch.value = true
    expect(panels.ai.value).toBe(false)
    expect(panels.files.value).toBe(true)
    // Dropping an open tool into an occupied region selects the tool being moved.
    layout.value = moveWorkspaceTool(layout.value, 'files', 'right')
    expect(panels.files.value).toBe(true)
    expect(panels.batch.value).toBe(false)
    single.value = true; panels.monitor.value = true
    expect(panels.batch.value).toBe(false)
    expect(panels.monitor.value).toBe(true)
    single.value = false
    expect(workspacePanel(layout.value, 'files')).toBe('right')
  } finally { scope.stop() }
})
const workspacePanel = (layout: ReturnType<typeof defaultWorkspaceLayout>, id: WorkspacePanel) => layout.tools.find(tool => tool.id === id)?.panelEdge
