import { watch, type Ref } from 'vue'
import { WORKSPACE_TOOLS, workspacePanelEdge, type SshWorkspaceLayout, type WorkspacePanel } from '@shared/workspaceLayout'

/** The existing refs remain canonical for shortcuts, Docker snapshots and split restoration. */
export function useWorkspacePanelPolicy(layout: Ref<SshWorkspaceLayout>, panels: Record<WorkspacePanel, Ref<boolean>>, singlePanel: Ref<boolean>) {
  let latest: WorkspacePanel | undefined
  const ids = WORKSPACE_TOOLS.filter((id): id is WorkspacePanel => id !== 'docker')
  function reconcile(preferred?: WorkspacePanel) {
    const active = preferred && panels[preferred].value ? preferred : latest && panels[latest].value ? latest : ids.find(id => panels[id].value)
    if (!active) return
    latest = active
    const occupied = new Set([workspacePanelEdge(layout.value, active)])
    for (const id of [active, ...ids.filter(id => id !== active)]) {
      if (!panels[id].value || id === active) continue
      const edge = workspacePanelEdge(layout.value, id)
      if (singlePanel.value || occupied.has(edge)) panels[id].value = false
      else occupied.add(edge)
    }
  }
  for (const id of ids) watch(panels[id], visible => { if (visible) reconcile(id) }, { flush: 'sync' })
  watch(layout, (next, previous) => {
    const moved = ids.find(id => panels[id].value && workspacePanelEdge(next, id) !== workspacePanelEdge(previous, id))
    reconcile(moved)
  }, { flush: 'sync' })
  watch(singlePanel, () => reconcile(), { flush: 'sync' })
}
