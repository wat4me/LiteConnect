/** Stop admission synchronously, drain within one budget, then release transports/storage. */
export function createShutdown(ports: {
  stopServices: () => Promise<void>
  stopMonitors: ReadonlyArray<() => void>
  sealServices: () => void
  closeTransports: ReadonlyArray<() => void>
  closeStorage: () => void
  onError: (error: unknown) => void
  timeoutMs?: number
}) {
  let stopping = false
  let pending: Promise<void> | undefined
  const safely = (action: () => void) => { try { action() } catch (error) { ports.onError(error) } }
  return {
    get stopping() { return stopping },
    stop(): Promise<void> {
      if (pending) return pending
      stopping = true
      // Set the flag before invoking hooks: none may restart delayed work.
      let drain: Promise<void>
      try { drain = Promise.resolve(ports.stopServices()).catch(ports.onError) }
      catch (error) { ports.onError(error); drain = Promise.resolve() }
      for (const stop of ports.stopMonitors) safely(stop)
      pending = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined
        const deadline = new Promise<void>(resolve => {
          timer = setTimeout(() => { ports.onError(new Error('Application shutdown drain timed out')); resolve() }, ports.timeoutMs ?? 5000)
        })
        try { await Promise.race([drain, deadline]) }
        finally {
          clearTimeout(timer)
          safely(ports.sealServices)
          for (const close of ports.closeTransports) safely(close)
          safely(ports.closeStorage)
        }
      })()
      return pending
    },
  }
}

interface QuitEvent { defaultPrevented: boolean; preventDefault(): void }

/** The update guard must be installed before this listener. */
export function installGracefulQuit(app: { on(event: 'before-quit', listener: (event: QuitEvent) => void): unknown; quit(): void },
  shutdown: { stop(): Promise<void> }, markQuitting: () => void, onError: (error: unknown) => void) {
  let finishing = false
  let ready = false
  app.on('before-quit', event => {
    if (event.defaultPrevented || ready) return
    event.preventDefault()
    if (finishing) return
    finishing = true
    markQuitting()
    void shutdown.stop().catch(onError).finally(() => {
      ready = true
      app.quit()
    })
  })
}
