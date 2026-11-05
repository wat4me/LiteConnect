export const WORKSPACE_EDGES = ['left', 'right'] as const
export type WorkspaceEdge = typeof WORKSPACE_EDGES[number]
export const WORKSPACE_TOOLS = ['ai', 'files', 'monitor', 'batch', 'sync', 'snippets', 'docker'] as const
export type WorkspaceTool = typeof WORKSPACE_TOOLS[number]
export type WorkspacePanel = Exclude<WorkspaceTool, 'docker'>
export type WorkspacePlacement = { id: WorkspaceTool; edge: WorkspaceEdge; panelEdge: WorkspaceEdge }
export type SshWorkspaceLayout = { version: 1; locked: boolean; tools: WorkspacePlacement[]; sizes: Record<WorkspaceEdge, number> }
const defaultPanelEdges: Record<WorkspaceTool, WorkspaceEdge> = { ai: 'left', files: 'left', monitor: 'right', batch: 'right', sync: 'left', snippets: 'right', docker: 'left' }
const defaultSizes = { left: 360, right: 320 }

export function defaultWorkspaceLayout(): SshWorkspaceLayout {
  return { version: 1, locked: false, tools: WORKSPACE_TOOLS.map(id => ({ id, edge: 'left', panelEdge: defaultPanelEdges[id] })), sizes: { ...defaultSizes } }
}
export const isWorkspaceTool = (id: unknown): id is WorkspaceTool => WORKSPACE_TOOLS.includes(id as WorkspaceTool)
export const isWorkspaceEdge = (edge: unknown): edge is WorkspaceEdge => WORKSPACE_EDGES.includes(edge as WorkspaceEdge)
export const isWorkspacePanel = (id: WorkspaceTool): id is WorkspacePanel => id !== 'docker'
export function workspaceSize(edge: WorkspaceEdge, value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.max(240, Math.min(720, value))) : defaultSizes[edge]
}
function normalizeEdge(edge: unknown, fallback: WorkspaceEdge): WorkspaceEdge {
  if (edge === 'top') return 'left'
  if (edge === 'bottom') return 'right'
  return isWorkspaceEdge(edge) ? edge : fallback
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
    tools.push({ id: entry.id, edge: normalizeEdge(entry.edge, 'left'), panelEdge: normalizeEdge(entry.panelEdge, defaultPanelEdges[entry.id]) })
  }
  return { version: 1, locked: value.locked === true, tools: [...tools, ...fallback.tools.filter(entry => !seen.has(entry.id))],
    sizes: { left: workspaceSize('left', value.sizes?.left), right: workspaceSize('right', value.sizes?.right) } }
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
