import type { WebContents } from 'electron'
import { classifyStreamLocalError } from './errorClassify'
import { DockerSocketTransport } from './transport'
import {
  type DockerServiceContext,
  type OwnedExecTerminal,
  type OwnedLogStream,
} from './serviceContext'
import {
  clearProbeInflightForSession,
  compareDockerApiVersions,
  DOCKER_MVP_MIN_API_VERSION,
  parseDockerApiVersion,
  ping as probePing,
  probe as runSessionProbe,
  version as probeVersion,
} from './serviceProbe'
import {
  clearActionInflightForSession,
  containerAction as runContainerActionApi,
  inspectContainer as inspectContainerApi,
  listContainers as listContainersApi,
} from './serviceContainers'
import {
  startContainerLogs as startLogsApi,
  stopContainerLogs as stopLogsApi,
  stopContainerLogsInternal,
  stopLogStreamsForSession,
} from './serviceLogs'
import {
  resizeContainerExec as resizeExecApi,
  startContainerExec as startExecApi,
  stopContainerExec as stopExecApi,
  stopContainerExecInternal,
  stopExecTerminalsForSession,
  writeContainerExec as writeExecApi,
} from './serviceExec'
import {
  DockerTransportError,
  type DockerAvailability,
  type DockerContainerAction,
  type DockerContainerActionResult,
  type DockerContainerInspectResult,
  type DockerContainerSummary,
  type DockerExecStartOptions,
  type DockerInstallationChecker,
  type DockerLogStreamOptionsWithRequest,
  type DockerProxyEndpoint,
  type DockerSessionHost,
  type DockerVersionInfo,
  type StreamLocalChannelOpener,
} from './types'

export {
  DOCKER_MVP_MIN_API_VERSION,
  parseDockerApiVersion,
  compareDockerApiVersions,
} from './serviceProbe'

export {
  isValidDockerLogStreamId,
  isValidDockerLogRequestId,
  isValidDockerExecTerminalId,
  isValidDockerExecRequestId,
} from './serviceIds'

/**
 * Main-process Docker Engine access over SSH StreamLocal + loopback proxy.
 * Domain logic lives in serviceProbe / serviceContainers / serviceLogs / serviceExec.
 */
export class DockerService {
  private readonly opener: StreamLocalChannelOpener
  private readonly installChecker: DockerInstallationChecker | null
  private readonly transport: DockerSocketTransport
  private readonly probeInflight = new Map<string, Promise<DockerAvailability>>()
  private readonly actionInflight = new Map<
    string,
    { action: DockerContainerAction; promise: Promise<DockerContainerActionResult> }
  >()
  private readonly logStreams = new Map<string, OwnedLogStream>()
  private readonly logOwnerIndex = new Map<string, string>()
  private readonly execTerminals = new Map<string, OwnedExecTerminal>()
  private readonly execOwnerIndex = new Map<number, string>()
  private unsubTeardown: (() => void) | null = null
  private hostDisposer: (() => void) | null = null

  constructor(host: StreamLocalChannelOpener | DockerSessionHost) {
    this.opener = host
    this.installChecker =
      'checkDockerInstallation' in host && typeof host.checkDockerInstallation === 'function'
        ? host
        : null
    this.hostDisposer = typeof (host as DockerSessionHost).dispose === 'function'
      ? () => (host as DockerSessionHost).dispose?.()
      : null
    this.transport = new DockerSocketTransport(host)
    this.unsubTeardown = this.opener.registerSessionTeardownHook((sessionId) => {
      clearProbeInflightForSession(this.ctx(), sessionId)
      clearActionInflightForSession(this.ctx(), sessionId)
      stopLogStreamsForSession(this.ctx(), sessionId, 'disconnected', 'ssh-disconnected')
      stopExecTerminalsForSession(this.ctx(), sessionId, 'disconnected', 'ssh-disconnected')
    })
  }

  private ctx(): DockerServiceContext {
    return {
      opener: this.opener,
      installChecker: this.installChecker,
      transport: this.transport,
      probeInflight: this.probeInflight,
      actionInflight: this.actionInflight,
      logStreams: this.logStreams,
      logOwnerIndex: this.logOwnerIndex,
      execTerminals: this.execTerminals,
      execOwnerIndex: this.execOwnerIndex,
      ensureTransport: (sessionId) => this.ensureTransport(sessionId),
      isGenerationLive: (sessionId, generation) => this.isGenerationLive(sessionId, generation),
      isEndpointLive: (sessionId, generation) => this.isEndpointLive(sessionId, generation),
      wrap: (err, sessionId) => this.wrap(err, sessionId),
    }
  }

  async ensureTransport(sessionId: string): Promise<DockerProxyEndpoint> {
    try {
      return await this.transport.ensureProxy(sessionId)
    } catch (err) {
      throw this.wrap(err, sessionId)
    }
  }

  async probe(sessionId: string): Promise<DockerAvailability> {
    return runSessionProbe(this.ctx(), sessionId)
  }

  async ping(sessionId: string): Promise<boolean> {
    return probePing(this.ctx(), sessionId)
  }

  async version(sessionId: string): Promise<DockerVersionInfo> {
    return probeVersion(this.ctx(), sessionId)
  }

  async listContainers(sessionId: string): Promise<DockerContainerSummary[]> {
    return listContainersApi(this.ctx(), sessionId)
  }

  async inspectContainer(
    sessionId: string,
    containerId: string,
  ): Promise<DockerContainerInspectResult> {
    return inspectContainerApi(this.ctx(), sessionId, containerId)
  }

  async containerAction(
    sessionId: string,
    containerId: string,
    action: DockerContainerAction,
  ): Promise<DockerContainerActionResult> {
    return runContainerActionApi(this.ctx(), sessionId, containerId, action)
  }

  async startContainerLogs(
    owner: WebContents,
    sessionId: string,
    containerId: string,
    options: DockerLogStreamOptionsWithRequest,
  ): Promise<string> {
    return startLogsApi(this.ctx(), owner, sessionId, containerId, options)
  }

  stopContainerLogs(owner: WebContents, streamId: string): boolean {
    return stopLogsApi(this.ctx(), owner, streamId)
  }

  getLogStreamCount(): number {
    return this.logStreams.size
  }

  getExecTerminalCount(): number {
    return this.execTerminals.size
  }

  async startContainerExec(
    owner: WebContents,
    sessionId: string,
    containerId: string,
    options: DockerExecStartOptions,
  ): Promise<string> {
    return startExecApi(this.ctx(), owner, sessionId, containerId, options)
  }

  writeContainerExec(owner: WebContents, terminalId: string, data: string | Buffer): boolean {
    return writeExecApi(this.ctx(), owner, terminalId, data)
  }

  async resizeContainerExec(
    owner: WebContents,
    terminalId: string,
    cols: number,
    rows: number,
  ): Promise<boolean> {
    return resizeExecApi(this.ctx(), owner, terminalId, cols, rows)
  }

  stopContainerExec(owner: WebContents, terminalId: string): boolean {
    return stopExecApi(this.ctx(), owner, terminalId)
  }

  closeSession(sessionId: string): void {
    clearProbeInflightForSession(this.ctx(), sessionId)
    clearActionInflightForSession(this.ctx(), sessionId)
    stopLogStreamsForSession(this.ctx(), sessionId, 'disconnected', 'ssh-disconnected')
    stopExecTerminalsForSession(this.ctx(), sessionId, 'disconnected', 'ssh-disconnected')
    this.transport.closeSession(sessionId)
  }

  closeAll(): void {
    this.probeInflight.clear()
    this.actionInflight.clear()
    for (const id of [...this.logStreams.keys()]) {
      stopContainerLogsInternal(this.ctx(), id, 'stopped', undefined, false)
    }
    this.logStreams.clear()
    this.logOwnerIndex.clear()
    for (const id of [...this.execTerminals.keys()]) {
      stopContainerExecInternal(this.ctx(), id, 'stopped', undefined, false)
    }
    this.execTerminals.clear()
    this.execOwnerIndex.clear()
    this.transport.closeAll()
    try {
      this.unsubTeardown?.()
    } catch {}
    this.unsubTeardown = null
    try {
      this.hostDisposer?.()
    } catch {}
    this.hostDisposer = null
  }

  getTransport(): DockerSocketTransport {
    return this.transport
  }

  getProbeInflightSize(): number {
    return this.probeInflight.size
  }

  getActionInflightSize(): number {
    return this.actionInflight.size
  }

  private isGenerationLive(sessionId: string, generation: number): boolean {
    if (!this.opener.hasSession(sessionId)) return false
    return this.opener.getSessionGeneration(sessionId) === generation
  }

  private isEndpointLive(sessionId: string, generation: number): boolean {
    const active = this.transport.getActiveEndpoint(sessionId)
    return !!active && active.generation === generation
  }

  private wrap(err: unknown, sessionId: string): DockerTransportError {
    if (err instanceof DockerTransportError) {
      if (!err.sessionId) {
        return new DockerTransportError(err.code, err.message, sessionId)
      }
      return err
    }
    return classifyStreamLocalError(err, sessionId)
  }
}
