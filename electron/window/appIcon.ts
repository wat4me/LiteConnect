import { existsSync } from 'fs'
import { join } from 'path'

export function windowAppId(packaged: boolean) { return packaged ? 'com.liteconnect.app' : 'com.liteconnect.app.dev' }

export function resolveAppIcon(appPath: string, resourcesPath: string, packaged: boolean, platform = process.platform): string | undefined {
  const names = platform === 'win32' ? ['LiteConnect.ico', 'LiteConnect-app.png', 'LiteConnect.png', 'liteConnect.ico', 'liteConnect.png'] : ['LiteConnect-app.png', 'LiteConnect.png', 'liteConnect.png']
  const roots = packaged ? [resourcesPath, join(appPath, 'dist')] : [join(appPath, 'build'), join(appPath, 'public'), join(appPath, 'dist')]
  return roots.flatMap(root => names.map(name => join(root, name))).find(path => existsSync(path))
}
