import type { Connection } from './types'
import { getX11Display, getX11Host, probeX11Port } from './x11/x11'
import { t } from '../i18n'
import { randomBytes } from 'node:crypto'
import { resolveX11Mode } from '../../shared/x11Policy'
import { probeAuthenticatedX11Endpoint, type X11Authentication } from './x11/x11Auth'
import type { X11Endpoint } from './x11/x11Endpoint'
import { SSH_CONNECTION_CANCELLED } from '../../shared/sshConnectionProgress'

export type PreparedX11 = { connection: Connection; auth: X11Authentication; endpoint?: X11Endpoint; screen?: number }

export type ResolvedConnectionX11 = {
  useX11: boolean
  x11Notice?: string
  prepared?: PreparedX11
}

/** Cancelling one SSH attempt must not cancel a display shared by other tabs. */
export function resolveConnectionX11(connection: Connection, signal?: AbortSignal): Promise<ResolvedConnectionX11> {
  if (signal?.aborted) return Promise.reject(new Error(SSH_CONNECTION_CANCELLED))
  const starting = prepareConnectionX11(connection)
  if (!signal) return starting
  return new Promise((resolve, reject) => {
    const abort = () => reject(new Error(SSH_CONNECTION_CANCELLED))
    signal.addEventListener('abort', abort, { once: true })
    void starting.then(result => { signal.removeEventListener('abort', abort); resolve(result) }, error => {
      signal.removeEventListener('abort', abort)
      reject(error)
    })
  })
}

async function prepareConnectionX11(connection: Connection): Promise<ResolvedConnectionX11> {
  const mode = resolveX11Mode(connection)
  if (mode === 'off') return { useX11: false }
  if (mode === 'auto') {
    try {
      const { ensureAutomaticLocalX11 } = await import('./x11/automaticX11')
      const target = await ensureAutomaticLocalX11()
      return {
        useX11: true,
        prepared: {
          connection: { ...connection, x11Forwarding: true, x11Host: 'host' in target.endpoint ? target.endpoint.host : '127.0.0.1', x11Display: target.display },
          auth: { remoteCookie: randomBytes(16), localCookie: target.localCookie },
          endpoint: target.endpoint, screen: target.screen,
        },
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return { useX11: false, x11Notice: `\r\n\x1b[33m[LiteConnect] ${t('x11.skipped', { detail })}\x1b[0m\r\n` }
    }
  }
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
export async function recheckConnectionX11(connection: Connection, prepared?: PreparedX11): Promise<{
  ready: boolean
  notice?: string
}> {
  if (prepared) {
    const target = prepared.connection
    const endpoint = prepared.endpoint ?? { host: getX11Host(target), port: 6000 + getX11Display(target) }
    const ready = await probeAuthenticatedX11Endpoint(endpoint, prepared.auth.localCookie)
    return ready ? { ready: true } : { ready: false, notice: `\r\n\x1b[33m[LiteConnect] ${t('x11.skipped', { detail: t('x11.notReady') })}\x1b[0m\r\n` }
  }
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
