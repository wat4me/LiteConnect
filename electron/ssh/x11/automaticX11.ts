import { t } from '../../i18n'
import { getX11ServerOptions } from './x11Server'
import type { SystemX11Target } from './systemX11'

export async function ensureAutomaticLocalX11(options?: { force?: boolean; executablePath?: string }): Promise<SystemX11Target> {
  if (!options?.force && !getX11ServerOptions().autoStart) throw new Error(t('x11.automaticDisabled'))
  if (process.platform === 'win32') {
    const { managedX11Server } = await import('./managedX11')
    const target = await managedX11Server.ensure(options?.executablePath)
    return {
      ...target, endpoint: { host: target.host, port: 6000 + target.display },
      displayAddress: `${target.host}:${6000 + target.display}`, screen: 0, started: false,
    }
  }
  const { systemX11Service } = await import('./systemX11')
  return systemX11Service.ensure()
}

export async function stopAutomaticX11(): Promise<void> {
  const [{ managedX11Server }, { systemX11Service }] = await Promise.all([import('./managedX11'), import('./systemX11')])
  await Promise.all([managedX11Server.stop(), systemX11Service.stop()])
}
