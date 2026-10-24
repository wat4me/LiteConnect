import { ipcMain } from 'electron'

/** Admission and in-flight ownership for the delayed service IPC handlers. */
export class ServiceIpcScope {
  private readonly channels = new Set<string>()
  private readonly pending = new Set<Promise<unknown>>()
  private readonly controller = new AbortController()
  get signal() { return this.controller.signal }

  assertOpen(): void {
    if (this.signal.aborted) throw new Error('Application services are stopping')
  }

  handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
    this.assertOpen()
    ipcMain.handle(channel, (event, ...args) => {
      this.assertOpen()
      const task = Promise.resolve().then(() => { this.assertOpen(); return listener(event, ...args) })
      this.pending.add(task)
      void task.then(() => this.pending.delete(task), () => this.pending.delete(task))
      return task
    })
    this.channels.add(channel)
  }

  dispose(): void {
    if (this.signal.aborted) return
    this.controller.abort()
    for (const channel of this.channels) ipcMain.removeHandler(channel)
    this.channels.clear()
  }

  async waitForIdle() { await Promise.allSettled([...this.pending]) }
}
