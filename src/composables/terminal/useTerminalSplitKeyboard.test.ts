import { describe, expect, it, vi } from 'vitest'
import { createTerminalSplitShortcutHandler } from './useTerminalSplitKeyboard'

function key(overrides: Partial<KeyboardEvent>) {
  return {
    target: {}, code: '', key: '', ctrlKey: false, shiftKey: false,
    altKey: false, metaKey: false, repeat: false,
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent
}

describe('terminal split shortcuts', () => {
  it('toggles layout and focuses the pane matching an arrow direction', () => {
    const toggleVertical = vi.fn()
    const focusSession = vi.fn()
    const clearMaximize = vi.fn()
    let isSplit = false
    const handler = createTerminalSplitShortcutHandler({
      workspaceVisible: () => true, dockerTabActive: () => false,
      container: () => ({ contains: () => true }) as unknown as HTMLElement,
      canUseLayoutButtons: () => true, isSplit: () => isSplit,
      splitMode: () => 'vertical', splitHasSecondary: () => true,
      primarySessionId: () => 'a', secondarySessionId: () => 'b',
      secondarySide: () => 'right', toggleVertical,
      toggleHorizontal: vi.fn(), clearMaximize, focusSession,
    })
    handler(key({ code: 'Backslash', ctrlKey: true, shiftKey: true }))
    expect(toggleVertical).toHaveBeenCalledOnce()
    isSplit = true
    handler(key({ key: 'ArrowRight', altKey: true }))
    expect(clearMaximize).toHaveBeenCalledOnce()
    expect(focusSession).toHaveBeenCalledWith('b')
  })
})
