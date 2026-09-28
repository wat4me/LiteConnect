import { app } from 'electron'

/** Route later launches to the already-running app before any window is created. */
export function installSingleInstance(restoreWindow: () => void): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }

  app.on('second-instance', restoreWindow)
  return true
}
