import { openDbSshTunnel, type DbTunnelHandle, type DbTunnelCloseReason } from './sshTunnel'
import type { DbConnection, DbEngine, DbTestParams } from './types'
import type { CredentialStore } from '../store/credentialStore'
import type { KnownHostsStore } from '../ssh/knownHosts'

export type DbTunnelLostReason = 'ssh_tunnel_closed' | 'ssh_tunnel_error'

export type DbTunnelOpenResult = {
  effective: DbConnection | DbTestParams
  tunnel: DbTunnelHandle | null
  sshName?: string
}

/**
 * Owns SSH tunnel open/close registry for database sessions.
 * DatabaseManager only consumes openIfNeeded / attach / has / close* — no direct ssh2.
 */
export class DbTunnelService {
  private tunnels = new Map<string, DbTunnelHandle>()
  private tunnelByConnection = new Map<string, Set<string>>()
  private credentialStore: CredentialStore | null = null
  private knownHosts: KnownHostsStore | null = null

  setDeps(credentialStore: CredentialStore, knownHosts: KnownHostsStore): void {
    this.credentialStore = credentialStore
    this.knownHosts = knownHosts
  }

  async openIfNeeded(
    conn: DbConnection | (DbTestParams & { id?: string; name?: string }),
  ): Promise<DbTunnelOpenResult> {
    const sshId =
      typeof (conn as DbConnection).sshConnectionId === 'string'
        ? (conn as DbConnection).sshConnectionId!.trim()
        : ''
    if (!sshId) {
      return { effective: conn, tunnel: null }
    }
    if (!this.credentialStore || !this.knownHosts) {
      throw new Error('SSH tunnel is not available')
    }
    await this.credentialStore.init()
    const ssh = this.credentialStore.getConnectionForAuth(sshId)
    if (!ssh) throw new Error('SSH connection not found for tunnel')

    const remoteHost = (conn.host || '').trim() || '127.0.0.1'
    const remotePort = conn.port || defaultDbPort(conn.engine)
    const tunnel = await openDbSshTunnel(ssh, remoteHost, remotePort, this.knownHosts)
    const effective = {
      ...conn,
      host: tunnel.localHost,
      port: tunnel.localPort,
    }
    return { effective, tunnel, sshName: ssh.name }
  }

  /**
   * Bind tunnel to a live db session. Unexpected SSH drops invoke onLost once;
   * intentional close* removes the entry first so onClosed is ignored.
   */
  attach(
    sessionId: string,
    connectionId: string,
    tunnel: DbTunnelHandle,
    onLost: (reason: DbTunnelLostReason) => void,
  ): void {
    this.tunnels.set(sessionId, tunnel)
    let set = this.tunnelByConnection.get(connectionId)
    if (!set) {
      set = new Set()
      this.tunnelByConnection.set(connectionId, set)
    }
    set.add(sessionId)

    tunnel.onClosed?.((reason: DbTunnelCloseReason) => {
      if (reason === 'local_close') return
      if (!this.tunnels.has(sessionId)) return
      const lost: DbTunnelLostReason =
        reason === 'ssh_tunnel_error' ? 'ssh_tunnel_error' : 'ssh_tunnel_closed'
      onLost(lost)
    })
  }

  has(sessionId: string): boolean {
    return this.tunnels.has(sessionId)
  }

  closeSession(sessionId: string): void {
    const tunnel = this.tunnels.get(sessionId)
    this.tunnels.delete(sessionId)
    if (tunnel) {
      try {
        tunnel.close()
      } catch {}
    }
    for (const [connId, set] of this.tunnelByConnection) {
      if (set.delete(sessionId) && set.size === 0) {
        this.tunnelByConnection.delete(connId)
      }
    }
  }

  sessionsForConnection(connectionId: string): string[] {
    const set = this.tunnelByConnection.get(connectionId)
    return set ? [...set] : []
  }

  closeByConnectionId(connectionId: string): void {
    const set = this.tunnelByConnection.get(connectionId)
    if (!set) return
    for (const sid of [...set]) {
      const tunnel = this.tunnels.get(sid)
      this.tunnels.delete(sid)
      if (tunnel) {
        try {
          tunnel.close()
        } catch {}
      }
    }
    this.tunnelByConnection.delete(connectionId)
  }

  closeAll(): void {
    for (const tunnel of this.tunnels.values()) {
      try {
        tunnel.close()
      } catch {}
    }
    this.tunnels.clear()
    this.tunnelByConnection.clear()
  }

  sessionIds(): string[] {
    return [...this.tunnels.keys()]
  }
}

function defaultDbPort(engine?: DbEngine | string): number {
  return engine === 'postgres' ? 5432 : 3306
}
