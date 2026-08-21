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

describe('useDockerWorkspaceMode', () => {
  it('defaults to terminal and disables docker without session', () => {
    const activeSessionId = ref<string | null>(null)
    const panels = makePanels()
    const mode = useDockerWorkspaceMode({
      activeSessionId: computed(() => activeSessionId.value),
      panels,
    })
    expect(mode.workspaceMode.value).toBe('terminal')
    expect(mode.dockerButtonEnabled.value).toBe(false)
    expect(mode.isDockerMode.value).toBe(false)
  })

  it('enables docker only for connected active session', () => {
    const activeSessionId = ref<string | null>('s1')
    const panels = makePanels()
    const mode = useDockerWorkspaceMode({
      activeSessionId: computed(() => activeSessionId.value),
      panels,
    })
    mode.ensureSessionTracked('s1')
    expect(mode.dockerButtonEnabled.value).toBe(true)
    mode.markSessionConnected('s1', false)
    expect(mode.dockerButtonEnabled.value).toBe(false)
    mode.markSessionConnected('s1', true)
    expect(mode.dockerButtonEnabled.value).toBe(true)
  })

  it('tracks pending sessions as disconnected until marked live', () => {
    const activeSessionId = ref<string | null>('s1')
    const panels = makePanels()
    const mode = useDockerWorkspaceMode({
      activeSessionId: computed(() => activeSessionId.value),
      panels,
    })
    mode.ensureSessionTracked('s1', { connected: false })
    expect(mode.disconnectedSessionIds.value.has('s1')).toBe(true)
    expect(mode.isActiveSessionConnected.value).toBe(false)
    mode.markSessionConnected('s1', true)
    expect(mode.disconnectedSessionIds.value.has('s1')).toBe(false)
  })

  it('snapshots and hides sidebars when entering docker; restores on leave', () => {
    const activeSessionId = ref<string | null>('s1')
    const panels = makePanels({
      aiSidebarVisible: true,
      sidebarVisible: false,
      monitorVisible: true,
      batchPanelVisible: false,
      snippetsPanelVisible: true,
      snippetPaletteVisible: true,
    })
    const mode = useDockerWorkspaceMode({
      activeSessionId: computed(() => activeSessionId.value),
      panels,
    })
    mode.ensureSessionTracked('s1')
    mode.enterDocker()
    expect(mode.isDockerMode.value).toBe(true)
    expect(panels.aiSidebarVisible.value).toBe(false)
    expect(panels.monitorVisible.value).toBe(false)
    expect(panels.snippetsPanelVisible.value).toBe(false)
    expect(panels.snippetPaletteVisible.value).toBe(false)

    mode.enterTerminal()
    expect(mode.isDockerMode.value).toBe(false)
    expect(panels.aiSidebarVisible.value).toBe(true)
    expect(panels.monitorVisible.value).toBe(true)
    expect(panels.snippetsPanelVisible.value).toBe(true)
    expect(panels.snippetPaletteVisible.value).toBe(true)
  })

  it('remembers mode per session and does not leak sidebar state across sessions', () => {
    const activeSessionId = ref<string | null>('s1')
    const panels = makePanels({ sidebarVisible: true })
    const mode = useDockerWorkspaceMode({
      activeSessionId: computed(() => activeSessionId.value),
      panels,
    })
    mode.ensureSessionTracked('s1')
    mode.ensureSessionTracked('s2')
    mode.enterDocker()
    expect(mode.workspaceMode.value).toBe('docker')

    // Switch to s2 (terminal): sidebars from s1 docker hide must not restore s1 AI onto s2
    activeSessionId.value = 's2'
    mode.applyModeForActiveSession('s1', 's2')
    expect(mode.workspaceMode.value).toBe('terminal')
    expect(panels.aiSidebarVisible.value).toBe(false)
    expect(panels.sidebarVisible.value).toBe(false)

    panels.sidebarVisible.value = true
    panels.batchPanelVisible.value = true

    // Back to s1 docker: hide sidebars again, keep s1 docker mode
    activeSessionId.value = 's1'
    mode.applyModeForActiveSession('s2', 's1')
    expect(mode.workspaceMode.value).toBe('docker')
    expect(panels.sidebarVisible.value).toBe(false)
    expect(panels.batchPanelVisible.value).toBe(false)

    // s2 still terminal with its own snapshot when returning
    activeSessionId.value = 's2'
    mode.applyModeForActiveSession('s1', 's2')
    expect(mode.workspaceMode.value).toBe('terminal')
    expect(panels.sidebarVisible.value).toBe(true)
    expect(panels.batchPanelVisible.value).toBe(true)
  })

  it('blocks terminal panel toggles while in docker mode', () => {
    const activeSessionId = ref<string | null>('s1')
    const panels = makePanels()
    const mode = useDockerWorkspaceMode({
      activeSessionId: computed(() => activeSessionId.value),
      panels,
    })
    mode.ensureSessionTracked('s1')
    mode.enterDocker()
    let called = 0
    mode.withTerminalModeGuard(() => {
      called += 1
    })
    expect(called).toBe(0)
    mode.enterTerminal()
    mode.withTerminalModeGuard(() => {
      called += 1
    })
    expect(called).toBe(1)
  })

  it('toggleDockerWorkspace switches modes', () => {
    const activeSessionId = ref<string | null>('s1')
    const panels = makePanels({ monitorVisible: true })
    const mode = useDockerWorkspaceMode({
      activeSessionId: computed(() => activeSessionId.value),
      panels,
    })
    mode.ensureSessionTracked('s1')
    mode.toggleDockerWorkspace()
    expect(mode.isDockerMode.value).toBe(true)
    expect(panels.monitorVisible.value).toBe(false)
    mode.toggleDockerWorkspace()
    expect(mode.isDockerMode.value).toBe(false)
    expect(panels.monitorVisible.value).toBe(true)
  })

  it('forgetSession drops mode and connection flags', () => {
    const activeSessionId = ref<string | null>('s1')
    const panels = makePanels()
    const mode = useDockerWorkspaceMode({
      activeSessionId: computed(() => activeSessionId.value),
      panels,
    })
    mode.ensureSessionTracked('s1')
    mode.enterDocker()
    mode.forgetSession('s1')
    // entry recreated as terminal default when read again
    expect(mode._getEntry('s1').mode).toBe('terminal')
  })
})
