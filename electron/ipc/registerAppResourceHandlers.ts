import { ipcMain } from 'electron'
import { collectLiveResourceStats, type ResourceStatsDeps } from '../app/resourceStats'

export function registerAppResourceHandlers(deps: ResourceStatsDeps): void {
  ipcMain.handle('app:getResourceStats', () => collectLiveResourceStats(deps))
}
