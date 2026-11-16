import { describe, expect, it, vi } from 'vitest'
import { computed, ref } from 'vue'
import { useAppKeyboard } from './useAppKeyboard'

function makeKb(overrides: Partial<Pick<Parameters<typeof useAppKeyboard>[0], 'activeGroup' | 'toggleDocker'>> = {}) {
  return useAppKeyboard({
    isHomeActive: computed(() => false),
    isSshWorkspace: computed(() => true),
    activeGroup: computed(() => null),
    toggleSidebar: vi.fn(),
    toggleAiSidebar: vi.fn(),
    toggleMonitor: vi.fn(),
    toggleBatchPanel: vi.fn(),
    hostKeyMismatchVisible: ref(false),
    decryptionFailedVisible: ref(false),
    ...overrides,
  })
}

function keyEvent(init: {
  key: string
  code?: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
}): KeyboardEvent & { defaultPrevented: boolean } {
  const e = {
    type: 'keydown',
    key: init.key,
    code: init.code ?? '',
    ctrlKey: init.ctrlKey ?? false,
    metaKey: init.metaKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    defaultPrevented: false,
    preventDefault() {
      e.defaultPrevented = true
    },
  }
  return e as KeyboardEvent & { defaultPrevented: boolean }
}

describe('useAppKeyboard page zoom', () => {
  it('preventDefault on Ctrl+= / Ctrl++ / Ctrl+0 so Chromium does not scale the SSH page', () => {
    const { handlePageZoomKeydown } = makeKb()
    for (const init of [
      { key: '=', code: 'Equal', ctrlKey: true },
      { key: '+', code: 'Equal', ctrlKey: true, shiftKey: true },
      { key: '0', code: 'Digit0', ctrlKey: true },
    ]) {
      const e = keyEvent(init)
      handlePageZoomKeydown(e)
      expect(e.defaultPrevented).toBe(true)
    }
  })

  it('does not treat Ctrl+K as page zoom', () => {
    const { handlePageZoomKeydown } = makeKb()
    const e = keyEvent({ key: 'k', code: 'KeyK', ctrlKey: true })
    handlePageZoomKeydown(e)
    expect(e.defaultPrevented).toBe(false)
  })
})

describe('useAppKeyboard Docker module', () => {
  it('Ctrl+Shift+D toggles Docker', () => {
    const toggleDocker = vi.fn()
    const { handleKeydown } = makeKb({ toggleDocker })
    const e = keyEvent({ key: 'd', ctrlKey: true, shiftKey: true })
    handleKeydown(e)
    expect(e.defaultPrevented).toBe(true)
    expect(toggleDocker).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+D without Shift does not toggle Docker', () => {
    const toggleDocker = vi.fn()
    const { handleKeydown } = makeKb({ toggleDocker })
    const e = keyEvent({ key: 'd', ctrlKey: true })
    handleKeydown(e)
    expect(toggleDocker).not.toHaveBeenCalled()
  })
})

it.each([{ ctrlKey: true }, { metaKey: true }])('leaves Ctrl/Cmd+W unhandled with an open SSH connection (%o)', modifiers => {
  const session = { id: 'session-1', connectionId: 'host-1', connectionName: 'Server', tabNumber: 1 }
  const { handleKeydown } = makeKb({
    activeGroup: computed(() => ({
      connectionId: session.connectionId,
      connectionName: session.connectionName,
      sessions: [session],
      activeSessionId: session.id,
      nextTabNumber: 2,
    })),
  })
  const e = keyEvent({ key: 'w', code: 'KeyW', ...modifiers })
  handleKeydown(e)
  expect(e.defaultPrevented).toBe(false)
})
