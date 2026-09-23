import type { Connection } from './types'
import { getX11Display, getX11Host, probeX11Port } from './x11/x11'
import { t } from '../i18n'

export async function resolveConnectionX11(connection: Connection): Promise<{
  useX11: boolean
  x11Notice?: string
}> {
  if (connection.x11Forwarding !== true) return { useX11: false }
  const host = getX11Host(connection)
  const display = getX11Display(connection)
  const { ensureX11ServerReady } = await import('./x11/x11Server')
  const result = await ensureX11ServerReady(host, display)
  if (result.ready) {
    const note = result.started
      ? `\r\n\x1b[32m[LiteConnect] ${t('x11.autoStarted', { host, port: result.port })}\x1b[0m\r\n`
      : undefined
    return { useX11: true, x11Notice: note }
  }
  const detail = result.message || t('x11.notReady')
  return {
    useX11: false,
    x11Notice: `\r\n\x1b[33m[LiteConnect] ${t('x11.skipped', { detail })}\x1b[0m\r\n`,
  }
}

/** Recheck local display after SSH authentication, which may take several seconds. */
export async function recheckConnectionX11(connection: Connection): Promise<{
  ready: boolean
  notice?: string
}> {
  const host = getX11Host(connection)
  const display = getX11Display(connection)
  const port = 6000 + display
  if (await probeX11Port(host, port)) return { ready: true }
  const { ensureX11ServerReady } = await import('./x11/x11Server')
  const result = await ensureX11ServerReady(host, display)
  if (result.ready) {
    return {
      ready: true,
      notice: result.started
        ? `\r\n\x1b[32m[LiteConnect] ${t('x11.autoStarted', { host, port })}\x1b[0m\r\n`
        : undefined,
    }
  }
  const detail = result.message || t('x11.notReady')
  return {
    ready: false,
    notice: `\r\n\x1b[33m[LiteConnect] ${t('x11.skipped', {
      detail: t('x11.recheckFailed', { host, port, detail }),
    })}\x1b[0m\r\n`,
  }
}
