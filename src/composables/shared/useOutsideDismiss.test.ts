import { describe, expect, it } from 'vitest'
import { eventIsInsideRoots } from './useOutsideDismiss'

function fakeEvent(path: unknown[], target?: unknown): Event {
  return {
    composedPath: () => path as EventTarget[],
    target: (target ?? path[0] ?? null) as EventTarget,
  } as Event
}

describe('eventIsInsideRoots', () => {
  it('treats composedPath members as inside the popup', () => {
    const popup = { id: 'popup' } as unknown as HTMLElement
    const icon = { id: 'svg' }
    expect(eventIsInsideRoots(fakeEvent([icon, popup]), [popup])).toBe(true)
  })

  it('dismisses when the path never hits ignore roots', () => {
    const popup = { id: 'popup' } as unknown as HTMLElement
    const terminal = { id: 'xterm' }
    expect(eventIsInsideRoots(fakeEvent([terminal]), [popup])).toBe(false)
  })

  it('ignores empty roots', () => {
    expect(eventIsInsideRoots(fakeEvent([{ id: 'x' }]), [null, undefined])).toBe(false)
  })
})
