import { beforeEach, describe, expect, it, vi } from 'vitest'

const { FakeNotification, notificationInstances } = vi.hoisted(() => {
  const instances: Array<{
    options: Record<string, unknown>
    show: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    click: () => void
  }> = []

  class NotificationMock {
    static isSupported = vi.fn(() => true)
    options: Record<string, unknown>
    show = vi.fn()
    close = vi.fn()
    private listeners = new Map<string, () => void>()

    constructor(options: Record<string, unknown>) {
      this.options = options
      instances.push(this)
    }

    on(event: string, listener: () => void) {
      this.listeners.set(event, listener)
      return this
    }

    click() {
      this.listeners.get('click')?.()
    }
  }

  return { FakeNotification: NotificationMock, notificationInstances: instances }
})

vi.mock('electron', () => ({ Notification: FakeNotification }))

import { showAiApprovalNotification } from './approvalNotification'

function makeWindow(overrides: Record<string, unknown> = {}) {
  return {
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isFocused: vi.fn(() => false),
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn(),
    webContents: {
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
    },
    ...overrides,
  }
}

describe('showAiApprovalNotification', () => {
  beforeEach(() => {
    notificationInstances.length = 0
    FakeNotification.isSupported.mockReturnValue(true)
  })

  it('does not interrupt a user already looking at the owning window', () => {
    const win = makeWindow({
      isVisible: vi.fn(() => true),
      isFocused: vi.fn(() => true),
    })
    expect(showAiApprovalNotification(win as never, { sessionId: 's', toolName: 'exec' }))
      .toBeUndefined()
    expect(notificationInstances).toHaveLength(0)
  })

  it('shows a private notification in the background and focuses the approval on click', () => {
    const win = makeWindow({ isMinimized: vi.fn(() => true) })
    const close = showAiApprovalNotification(win as never, {
      sessionId: 'session-1',
      toolName: 'exec',
    })

    expect(notificationInstances).toHaveLength(1)
    const notification = notificationInstances[0]
    expect(notification.options.body).not.toContain('rm')
    expect(notification.show).toHaveBeenCalledOnce()

    notification.click()
    expect(win.restore).toHaveBeenCalledOnce()
    expect(win.show).toHaveBeenCalledOnce()
    expect(win.focus).toHaveBeenCalledOnce()
    expect(win.webContents.send).toHaveBeenCalledWith(
      'ai:approvalNotificationClick',
      'session-1',
    )

    close?.()
    expect(notification.close).toHaveBeenCalledOnce()
  })
})
