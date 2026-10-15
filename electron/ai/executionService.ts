import { randomUUID } from 'crypto'
import type { AiHistoryLimits } from '../../shared/aiHistoryLimits'
import type { AiChatResult, AiChatStreamOptions, AiChatStreamPayload, AiContextCheckpoint, AiHistoryRecord, AiResolvedConfig, AiSessionStore } from '../../shared/types/ai'
import { flattenConversationForApi } from '../../shared/aiMessages'
import type { AiWorkspaceTarget } from '../../shared/aiWorkspace'
import type { SshMcpRuntime } from '../mcp/runtime'
import { t } from '../i18n'
import { AiBackgroundJobs, backgroundJobNotice, type AiJobOwner } from './backgroundJobs'
import { runAiChatStream } from './chatStream'
import { abortAiChatStream, createAiStreamControl, resolveToolApproval } from './streamControl'
import { runPersistedAiReply } from './streamPersistence'
import { createStreamPublisher } from './streamPublisher'

export type AiExecutionOwner = {
  /** A transport identity for interactive clients, or a stable automation identity. */
  id: number | string
  kind: 'interactive' | 'automation'
  isAlive?: () => boolean
  onDisposed?: (callback: () => void) => () => void
}

export interface AiExecutionRequest {
  requestId: string
  /** Bounded scheduled runs cannot leave detached tool jobs behind. */
  foregroundOnly?: boolean
  /** Explicit history identity: execution is no longer keyed by a UI window. */
  historyId: string
  /** Optional per-run model config; falls back to the shared settings port. */
  settings?: AiResolvedConfig
  owner: AiExecutionOwner
  target: AiChatStreamOptions
}

export interface AiExecutionEvent {
  requestId: string
  target: AiChatStreamOptions
  trigger: 'interactive' | 'automation' | 'background'
}

export interface AiExecutionObserver {
  onStream?: (event: AiExecutionEvent & { payload: AiChatStreamPayload }) => void
  onRecord?: (event: AiExecutionEvent & { record: AiHistoryRecord }) => void
  onApproval?: NonNullable<Parameters<typeof runAiChatStream>[0]['onToolApprovalRequested']>
}

export interface AiExecutionPorts {
  settings: {
    ready: () => Promise<unknown>
    config: () => AiResolvedConfig
    limits: () => Partial<AiHistoryLimits>
  }
  history: {
    read: (historyId: string, limits: Partial<AiHistoryLimits>) => Promise<AiSessionStore>
    save: (historyId: string, record: AiHistoryRecord, threadId: string, limits: Partial<AiHistoryLimits>) => Promise<void>
    checkpoint: (historyId: string, threadId: string, checkpoint: AiContextCheckpoint, limits: Partial<AiHistoryLimits>) => Promise<void>
    hydrate: (historyId: string, store: AiSessionStore, threadId: string) => Promise<unknown>
  }
  workspaceOwned?: (sessionId: string, ownerId: number | string) => boolean
  workspaceTargets?: (sessionId: string, ownerId: number | string) => AiWorkspaceTarget[] | undefined
  runtime?: SshMcpRuntime
  onError?: (error: unknown) => void
}

const selectionKey = (ownerId: number | string, sessionId: string) => JSON.stringify([ownerId, sessionId])

/** Shared runtime for sidebar, future workspace and unattended read-only runs.
 * Storage and tools own execution; observers are optional projections only.
 */
export class AiExecutionService {
  private readonly runningHistories = new Set<string>()
  private readonly selections = new Map<string, { ownerId: number | string; threadId: string }>()
  private readonly owners = new Map<number | string, { owner: AiExecutionOwner; observer?: AiExecutionObserver; unsubscribe?: () => void }>()
  private readonly active = new Map<string, { owner: AiExecutionOwner; event: AiExecutionEvent; done: Promise<void> }>()
  private readonly jobs: AiBackgroundJobs
  private readonly unsubscribeJobs?: () => void
  private disposed = false

  constructor(private readonly ports: AiExecutionPorts) {
    this.jobs = new AiBackgroundJobs({
      getJob: id => ports.runtime?.getJobResult(id),
      busy: owner => this.runningHistories.has(owner.historyId),
      alive: owner => this.ownerAlive(owner),
      available: owner => this.ownerAlive(owner) && this.executionAvailable(owner) && this.selections.get(selectionKey(owner.ownerId, owner.sessionId))?.threadId === owner.threadId,
      deliver: async (owner, jobs) => {
        const destination = this.owners.get(owner.ownerId)
        if (!destination) return
        const store = await ports.history.read(owner.historyId, ports.settings.limits())
        if (!this.jobs.canDeliver(owner)) return false
        if (!store.threads.some(thread => thread.id === owner.threadId)) return
        await this.execute({
          requestId: `ai-background-${randomUUID()}`, historyId: owner.historyId, owner: destination.owner,
          target: { sessionId: owner.sessionId, threadId: owner.threadId, assistantMessageId: randomUUID(), createdAt: Date.now(), cwd: owner.cwd },
        }, destination.observer, 'background', backgroundJobNotice(jobs, owner.targets))
      },
      onError: error => ports.onError?.(error),
    })
    this.unsubscribeJobs = ports.runtime?.onJobSettled(job => this.jobs.settled(job))
  }

  private ownerAlive(owner: AiJobOwner) {
    const destination = this.owners.get(owner.ownerId)
    try {
      const workspaceOwned = this.ports.workspaceOwned?.(owner.sessionId, owner.ownerId)
      return !this.disposed && Boolean(destination && destination.owner.isAlive?.() !== false &&
        (owner.sessionId.startsWith('workspace:') && workspaceOwned !== undefined ? workspaceOwned : this.executionAvailable(owner)))
    } catch { return false }
  }

  private executionAvailable(owner: AiJobOwner) {
    try {
      const targets = this.ports.workspaceTargets?.(owner.sessionId, owner.ownerId)
      return targets ? targets.every(target => this.ports.runtime?.hasSession(target.sessionId)) : Boolean(this.ports.runtime?.hasSession(owner.sessionId))
    } catch { return false }
  }

  selectConversation(ownerId: number | string, sessionId: string, threadId?: string) {
    if (threadId) this.selections.set(selectionKey(ownerId, sessionId), { ownerId, threadId })
    this.jobs.flush()
  }

  async run(request: AiExecutionRequest, observer?: AiExecutionObserver): Promise<AiChatResult> {
    this.validate(request)
    request = { ...request, owner: { ...request.owner }, target: { ...request.target } }
    const previous = this.owners.get(request.owner.id)
    if (previous && previous.owner.kind !== request.owner.kind) throw new Error('AI execution owner kind cannot change')
    const destination = { owner: { ...request.owner }, observer, unsubscribe: previous?.unsubscribe }
    this.owners.set(request.owner.id, destination)
    if (!previous) destination.unsubscribe = request.owner.onDisposed?.(() => this.disposeOwner(request.owner.id))
    this.selectConversation(request.owner.id, request.target.sessionId, request.target.threadId)
    this.jobs.resume(this.jobOwner(request))
    return this.execute(request, observer, request.owner.kind)
  }

  private validate(request: AiExecutionRequest) {
    if (this.disposed) throw new Error('AI execution service is disposed')
    const { owner, target } = request
    if (!request.requestId || typeof request.requestId !== 'string' || !request.historyId || typeof request.historyId !== 'string' ||
      !target || typeof target.sessionId !== 'string' || !target.sessionId || typeof target.threadId !== 'string' || !target.threadId ||
      typeof target.assistantMessageId !== 'string' || !target.assistantMessageId || !Number.isFinite(target.createdAt)) throw new Error('Invalid AI execution target')
    if (!owner || (owner.kind === 'interactive' ? typeof owner.id !== 'number' || !Number.isFinite(owner.id)
      : owner.kind !== 'automation' || typeof owner.id !== 'string' || !owner.id)) throw new Error('Invalid AI execution owner')
    if (owner.isAlive?.() === false) throw new Error('AI execution owner is unavailable')
  }

  private jobOwner(request: AiExecutionRequest, targets = this.ports.workspaceTargets?.(request.target.sessionId, request.owner.id)): AiJobOwner {
    return { historyId: request.historyId, sessionId: request.target.sessionId, threadId: request.target.threadId, ownerId: request.owner.id, cwd: request.target.cwd, sessionIds: targets?.map(target => target.sessionId), targets: targets?.map(target => ({ ...target })) }
  }

  private async execute(request: AiExecutionRequest, observer: AiExecutionObserver | undefined, trigger: AiExecutionEvent['trigger'], backgroundNotice?: string): Promise<AiChatResult> {
    this.validate(request)
    const { historyId, owner, requestId } = request
    const target = { ...request.target }
    if (this.runningHistories.has(historyId)) throw new Error('An AI reply is already running for this history')
    const control = createAiStreamControl(requestId, typeof owner.id === 'number' ? owner.id : undefined)
    const event: AiExecutionEvent = { requestId, target, trigger }
    let finish!: () => void
    const done = new Promise<void>(resolve => { finish = resolve })
    this.active.set(requestId, { owner, event, done })
    this.runningHistories.add(historyId)
    const publisher = createStreamPublisher(payload => observer?.onStream?.({ ...event, payload }))
    try {
      await this.ports.settings.ready()
      control.controller.signal.throwIfAborted()
      const workspaceTargets = this.ports.workspaceTargets?.(target.sessionId, request.owner.id)
      if (this.ports.runtime && !(workspaceTargets ? workspaceTargets.every(item => this.ports.runtime?.hasSession(item.sessionId)) : this.ports.runtime.hasSession(target.sessionId))) throw new Error('SSH session is unavailable for AI execution')
      const initial = await this.ports.history.read(historyId, this.ports.settings.limits())
      if (!initial.threads.some(thread => thread.id === target.threadId)) throw new Error('AI execution conversation no longer exists')
      return await runPersistedAiReply({
        target, backgroundNotice,
        save: async record => {
          await this.ports.history.save(historyId, record, target.threadId, this.ports.settings.limits())
          try { observer?.onRecord?.({ ...event, record }) } catch { /* Observers cannot break persistence. */ }
        },
        publish: publisher.publish,
        run: async (emit, checkpoint) => {
          control.controller.signal.throwIfAborted()
          await this.ports.settings.ready()
          control.controller.signal.throwIfAborted()
          const settings = request.settings || this.ports.settings.config()
          if (!settings.apiKey.trim()) throw new Error(t('ai.apiKeyRequired'))
          // Unattended execution has no approval UI. Its first-stage contract is
          // strictly read-only, even if global interactive settings allow writes.
          const permission = () => owner.kind === 'automation' ? 'readonly' as const : this.ports.settings.config().toolPermission || 'ask'
          const limits = this.ports.settings.limits()
          const store = await this.ports.history.read(historyId, limits)
          if (store.activeThreadId !== target.threadId) await this.ports.history.hydrate(historyId, store, target.threadId)
          const thread = store.threads.find(item => item.id === target.threadId)
          if (!thread) throw new Error('AI execution conversation no longer exists')
          const messages = flattenConversationForApi(thread.messages)
          if (backgroundNotice) messages.push({ role: 'user', content: backgroundNotice })
          return runAiChatStream({
            emit, checkpoint, requestId, messages, abortController: control.controller,
            workspaceTargets,
            sessionId: target.sessionId, cwd: typeof target.cwd === 'string' ? target.cwd : undefined,
            settings: { ...settings, toolPermission: permission() }, sshMcpRuntime: this.ports.runtime, foregroundOnly: request.foregroundOnly,
            onBackgroundJobsStarted: ids => {
              if (!this.disposed && this.owners.has(owner.id)) this.jobs.bind(this.jobOwner(request, workspaceTargets), ids)
            },
            onBackgroundJobCollected: id => this.jobs.collected(id, this.jobOwner(request, workspaceTargets)),
            contextFiles: thread.contextFiles, getToolPermission: permission,
            onToolApprovalRequested: owner.kind === 'interactive' ? observer?.onApproval : undefined,
            contextHistory: {
              compactionCount: thread.compactionCount, records: thread.messages, checkpoint: thread.contextCheckpoint,
              saveCheckpoint: next => this.ports.history.checkpoint(historyId, target.threadId, next, limits),
            },
          })
        },
      })
    } finally {
      publisher.flush()
      control.cleanup()
      this.active.delete(requestId)
      this.runningHistories.delete(historyId)
      finish()
      if (!this.disposed) this.jobs.flush()
    }
  }

  abort(ownerId: number | string, requestId: string): boolean {
    const active = this.active.get(requestId)
    if (!active || active.owner.id !== ownerId) return false
    const stopped = abortAiChatStream(requestId, typeof ownerId === 'number' ? ownerId : undefined)
    if (stopped) this.jobs.suppress(active.event.target.sessionId, active.event.target.threadId, ownerId)
    return stopped
  }

  resolveApproval(ownerId: number, requestId: string, callId: string, approved: boolean) {
    const active = this.active.get(requestId)
    return active?.owner.kind === 'interactive' && active.owner.id === ownerId
      ? resolveToolApproval(requestId, callId, approved, ownerId) : false
  }

  async suppressBackground(ownerId: number | string, sessionId: string, threadId: string) {
    this.jobs.suppress(sessionId, threadId, ownerId)
    for (const [requestId, active] of [...this.active]) {
      if (active.owner.id !== ownerId || active.event.trigger !== 'background' || active.event.target.sessionId !== sessionId || active.event.target.threadId !== threadId) continue
      this.abort(ownerId, requestId)
      await active.done
    }
  }

  disposeOwner(ownerId: number | string) {
    this.jobs.disposeOwner(ownerId)
    for (const [requestId, active] of this.active) if (active.owner.id === ownerId) this.abort(ownerId, requestId)
    this.owners.get(ownerId)?.unsubscribe?.()
    this.owners.delete(ownerId)
    for (const [key, selection] of this.selections) if (selection.ownerId === ownerId) this.selections.delete(key)
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.unsubscribeJobs?.()
    for (const ownerId of [...this.owners.keys()]) this.disposeOwner(ownerId)
    this.jobs.dispose()
  }
}
