export const WORKSPACE_EDGES = ['left', 'right', 'top', 'bottom'] as const
export type WorkspaceEdge = typeof WORKSPACE_EDGES[number]
export const WORKSPACE_TOOLS = ['ai', 'files', 'monitor', 'batch', 'sync', 'snippets', 'docker'] as const
export type WorkspaceTool = typeof WORKSPACE_TOOLS[number]
export type WorkspacePanel = Exclude<WorkspaceTool, 'docker'>
export type WorkspacePlacement = { id: WorkspaceTool; edge: WorkspaceEdge; panelEdge: WorkspaceEdge }
export type SshWorkspaceLayout = { version: 1; locked: boolean; tools: WorkspacePlacement[]; sizes: Record<WorkspaceEdge, number> }
const defaultPanelEdges: Record<WorkspaceTool, WorkspaceEdge> = { ai: 'left', files: 'left', monitor: 'bottom', batch: 'right', sync: 'top', snippets: 'right', docker: 'left' }

export function defaultWorkspaceLayout(): SshWorkspaceLayout {
  return { version: 1, locked: false, tools: WORKSPACE_TOOLS.map(id => ({ id, edge: 'left', panelEdge: defaultPanelEdges[id] })), sizes: { left: 360, right: 320, top: 220, bottom: 240 } }
}
export const isWorkspaceTool = (id: unknown): id is WorkspaceTool => WORKSPACE_TOOLS.includes(id as WorkspaceTool)
export const isWorkspaceEdge = (edge: unknown): edge is WorkspaceEdge => WORKSPACE_EDGES.includes(edge as WorkspaceEdge)
export const isWorkspacePanel = (id: WorkspaceTool): id is WorkspacePanel => id !== 'docker'
export function workspaceSize(edge: WorkspaceEdge, value: unknown): number {
  const side = edge === 'left' || edge === 'right'
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(side ? 240 : 120, Math.min(side ? 720 : 600, value))) : defaultWorkspaceLayout().sizes[edge]
}
/** Shared by the settings boundary and renderer; unknown tools never become dynamic components. */
export function normalizeWorkspaceLayout(raw: unknown): SshWorkspaceLayout {
  const fallback = defaultWorkspaceLayout()
  if (!raw || typeof raw !== 'object' || (raw as SshWorkspaceLayout).version !== 1) return fallback
  const value = raw as SshWorkspaceLayout, seen = new Set<WorkspaceTool>()
  const tools: WorkspacePlacement[] = []
  if (Array.isArray(value.tools)) for (const entry of value.tools.slice(0, 32)) {
    if (!entry || !isWorkspaceTool(entry.id) || seen.has(entry.id)) continue
    seen.add(entry.id)
    tools.push({ id: entry.id, edge: isWorkspaceEdge(entry.edge) ? entry.edge : 'left', panelEdge: isWorkspaceEdge(entry.panelEdge) ? entry.panelEdge : defaultPanelEdges[entry.id] })
  }
  return { version: 1, locked: value.locked === true, tools: [...tools, ...fallback.tools.filter(entry => !seen.has(entry.id))],
    sizes: Object.fromEntries(WORKSPACE_EDGES.map(edge => [edge, workspaceSize(edge, value.sizes?.[edge])])) as Record<WorkspaceEdge, number> }
}
export function moveWorkspaceTool(layout: SshWorkspaceLayout, id: WorkspaceTool, edge: WorkspaceEdge, before?: WorkspaceTool, alignPanel = false): SshWorkspaceLayout {
  if (layout.locked || !isWorkspaceTool(id) || !isWorkspaceEdge(edge) || before === id) return layout
  const previous = layout.tools.find(tool => tool.id === id)!
  const tools = layout.tools.filter(tool => tool.id !== id), placement = { id, edge, panelEdge: alignPanel || previous.edge !== edge ? edge : previous.panelEdge }
  const index = before ? tools.findIndex(tool => tool.id === before && tool.edge === edge) : -1
  if (index >= 0) tools.splice(index, 0, placement)
  else {
    const last = tools.reduce((last, tool, i) => tool.edge === edge ? i : last, -1)
    tools.splice(last < 0 ? tools.length : last + 1, 0, placement)
  }
  return { ...layout, tools }
}
export function workspacePanelEdge(layout: SshWorkspaceLayout, id: WorkspaceTool): WorkspaceEdge {
  return layout.tools.find(tool => tool.id === id)?.panelEdge || defaultPanelEdges[id]
}
