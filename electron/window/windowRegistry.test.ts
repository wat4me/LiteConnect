import { beforeEach, expect, it, vi } from 'vitest'

class FakeWindow {
  handlers = new Map<string, () => void>()
  destroyed = false

  on(name: string, handler: () => void) {
    this.handlers.set(name, handler)
  }

  isDestroyed() {
    return this.destroyed
  }

  close() {
    this.destroyed = true
    this.handlers.get('closed')?.()
  }
}

beforeEach(() => vi.resetModules())

it('does not treat a detached window as the main shell after the main window closes', async () => {
  const registry = await import('./windowRegistry')
  const main = new FakeWindow()
  const detached = new FakeWindow()
  registry.registerWindow(main as any, { primary: true })
  registry.registerWindow(detached as any, { primary: false })
  expect(registry.getMainShellWindow()).toBe(main)

  main.close()

  expect(registry.getMainShellWindow()).toBeNull()
  expect(registry.getPrimaryWindow()).toBe(detached)

  const reopenedMain = new FakeWindow()
  registry.registerWindow(reopenedMain as any, { primary: true })
  expect(registry.getMainShellWindow()).toBe(reopenedMain)
})
