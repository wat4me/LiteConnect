import { describe, expect, it } from 'vitest'
import { computed, ref } from 'vue'
import { useDockerWorkspaceMode, type SidebarPanelControls } from './useDockerWorkspaceMode'

function makePanels(initial?: Partial<Record<keyof SidebarPanelControls, boolean>>): SidebarPanelControls {
  return {
    aiSidebarVisible: ref(!!initial?.aiSidebarVisible),
    sidebarVisible: ref(!!initial?.sidebarVisible),
    monitorVisible: ref(!!initial?.monitorVisible),
    batchPanelVisible: ref(!!initial?.batchPanelVisible),
    snippetsPanelVisible: ref(!!initial?.snippetsPanelVisible),
    snippetPaletteVisible: ref(!!initial?.snippetPaletteVisible),
  }
}

function makeMode(opts?: {
  sessionId?: string | null
  connectionId?: string | null
  panels?: SidebarPanelControls
}) {
  const activeSessionId = ref<string | null>(opts?.sessionId === undefined ? 's1' : opts.sessionId)
  const activeConnectionId = ref<string | null>(
    opts?.connectionId === undefined ? 'c1' : opts.connectionId,
  )
  const panels = opts?.panels ?? makePanels()
  const mode = useDockerWorkspaceMode({
    activeSessionId: computed(() => activeSessionId.value),
    activeConnectionId: computed(() => activeConnectionId.value),
    panels,
  })
  return { mode, activeSessionId, activeConnectionId, panels }
}

describe('useDockerWorkspaceMode', () => {
  it('defaults to terminal and disables docker without session', () => {
    const { mode } = makeMode({ sessionId: null, connectionId: null })
    expect(mode.workspaceMode.value).toBe('terminal')
    expect(mode.dockerButtonEnabled.value).toBe(false)
    expect(mode.isDockerMode.value).toBe(false)
    expect(mode.dockerTabOpen.value).toBe(false)
  })

  it('enables docker only for connected active session', () => {
    const { mode } = makeMode()
    mode.ensureSessionTracked('s1')
    expect(mode.dockerButtonEnabled.value).toBe(true)
    mode.markSessionConnected('s1', false)
    expect(mode.dockerButtonEnabled.value).toBe(false)
    mode.markSessionConnected('s1', true)
    expect(mode.dockerButtonEnabled.value).toBe(true)
  })

  it('tracks pending sessions as disconnected until marked live', () => {
    const { mode } = makeMode()
    mode.ensureSessionTracked('s1', { connected: false })
    expect(mode.disconnectedSessionIds.value.has('s1')).toBe(true)
    expect(mode.isActiveSessionConnected.value).toBe(false)
    mode.markSessionConnected('s1', true)
    expect(mode.disconnectedSessionIds.value.has('s1')).toBe(false)
  })

  it('opens a per-connection Docker sub-tab without hiding sidebars', () => {
    const panels = makePanels({
      aiSidebarVisible: true,
      monitorVisible: true,
      snippetsPanelVisible: true,
    })
    const { mode } = makeMode({ panels })
    mode.ensureSessionTracked('s1')
    mode.enterDocker()
    expect(mode.isDockerMode.value).toBe(true)
    expect(mode.dockerTabOpen.value).toBe(true)
    expect(panels.aiSidebarVisible.value).toBe(true)
    expect(panels.monitorVisible.value).toBe(true)

    mode.enterTerminal()
    expect(mode.isDockerMode.value).toBe(false)
    expect(mode.dockerTabOpen.value).toBe(true)
    expect(panels.aiSidebarVisible.value).toBe(true)
  })

  it('closeDockerTab removes the sub-tab', () => {
    const { mode } = makeMode()
    mode.ensureSessionTracked('s1')
    mode.enterDocker()
    mode.closeDockerTab()
    expect(mode.isDockerMode.value).toBe(false)
    expect(mode.dockerTabOpen.value).toBe(false)
  })

  it('keeps docker tab state per connection, not per PTY', () => {
    const { mode, activeSessionId, activeConnectionId } = makeMode()
    mode.ensureSessionTracked('s1')
    mode.ensureSessionTracked('s2')
    mode.enterDocker()
    expect(mode.isDockerMode.value).toBe(true)

    activeSessionId.value = 's2'
    mode.applyModeForActiveSession('s1', 's2')
    expect(mode.isDockerMode.value).toBe(true)
    expect(mode.dockerTabOpen.value).toBe(true)

    activeConnectionId.value = 'c2'
    activeSessionId.value = 's3'
    mode.ensureSessionTracked('s3')
    expect(mode.isDockerMode.value).toBe(false)
    expect(mode.dockerTabOpen.value).toBe(false)

    activeConnectionId.value = 'c1'
    activeSessionId.value = 's2'
    expect(mode.isDockerMode.value).toBe(true)
  })

  it('toggleDockerWorkspace selects and deselects without closing the tab', () => {
    const { mode } = makeMode()
    mode.ensureSessionTracked('s1')
    mode.toggleDockerWorkspace()
    expect(mode.isDockerMode.value).toBe(true)
    expect(mode.dockerTabOpen.value).toBe(true)
    mode.toggleDockerWorkspace()
    expect(mode.isDockerMode.value).toBe(false)
    expect(mode.dockerTabOpen.value).toBe(true)
  })

  it('forgetSession drops connection flags; pruneConnections drops tabs', () => {
    const { mode } = makeMode()
    mode.ensureSessionTracked('s1')
    mode.enterDocker()
    mode.forgetSession('s1')
    expect(mode.disconnectedSessionIds.value.has('s1')).toBe(false)
    expect(mode.dockerTabOpen.value).toBe(true)
    mode.pruneConnections([])
    expect(mode.dockerTabOpen.value).toBe(false)
  })

  it('restores PTY sidebar snapshots when leaving docker for another session', () => {
    const panels = makePanels({ sidebarVisible: true })
    const { mode, activeSessionId, activeConnectionId } = makeMode({ panels })
    mode.ensureSessionTracked('s1')
    mode.ensureSessionTracked('s2')
    mode.enterDocker()
    mode.enterTerminal()

    activeConnectionId.value = 'c2'
    activeSessionId.value = 's2'
    mode.applyModeForActiveSession('s1', 's2')
    expect(panels.sidebarVisible.value).toBe(false)

    panels.batchPanelVisible.value = true
    activeConnectionId.value = 'c1'
    activeSessionId.value = 's1'
    mode.applyModeForActiveSession('s2', 's1')
    expect(panels.sidebarVisible.value).toBe(true)
    expect(panels.batchPanelVisible.value).toBe(false)
  })
})
