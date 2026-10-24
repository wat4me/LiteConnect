import type { SftpEventSender } from '../../../shared/ipc/sftp'
import { TransferCancelledError } from '../../../shared/transferCancellation'
import { randomUUID } from 'node:crypto'
import type { TransferConflictStrategy, UploadConflictDecision, UploadConflictRequest } from '../../../shared/types/sftp'

type Owner = {
  id: number
  isDestroyed(): boolean
  send: SftpEventSender
}
type Batch = { remaining: number; strategy?: TransferConflictStrategy; cancelled: boolean }
type Context = { owner: Owner; sessionId: string; transferId: string; batchKey: string; batch: Batch; cancelled: boolean }
type Request = { context: Context; payload: UploadConflictRequest; resolve: (action: TransferConflictStrategy) => void; reject: (error: Error) => void; cleanup: () => void }

/** Serializes prompts per window, while transfers and other windows keep running. */
export class UploadConflicts {
  private batches = new Map<string, Batch>()
  private contexts = new Map<string, Context>()
  private requests = new Map<string, Request>()
  private visible = new Map<number, string>()

  constructor(private cancelRun: (transferId: string) => void) {}

  register(owner: Owner, sessionId: string, transferId: string, batchId = transferId, batchSize = 1) {
    const batchKey = JSON.stringify([owner.id, sessionId, batchId])
    let batch = this.batches.get(batchKey)
    if (!batch) {
      batch = { remaining: batchSize, cancelled: false }
      this.batches.set(batchKey, batch)
    }
    const context: Context = { owner, sessionId, transferId, batchKey, batch, cancelled: false }
    this.contexts.set(transferId, context)
    return {
      isCancelled: () => context.cancelled || context.batch.cancelled || owner.isDestroyed(),
      ask: (localPath: string, remotePath: string, hostName?: string, signal?: AbortSignal) => {
        if (context.cancelled || context.batch.cancelled || owner.isDestroyed() || signal?.aborted) return Promise.reject(new TransferCancelledError())
        if (context.batch.strategy) return Promise.resolve(context.batch.strategy)
        return new Promise<TransferConflictStrategy>((resolve, reject) => {
          const payload = { requestId: randomUUID(), sessionId, transferId, localPath, remotePath, hostName }
          const abort = () => {
            const req = this.requests.get(payload.requestId)
            if (req) this.finish(req)
            this.pump(owner.id)
          }
          this.requests.set(payload.requestId, { context, payload, resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) })
          signal?.addEventListener('abort', abort, { once: true })
          this.pump(owner.id)
        })
      },
      dispose: () => {
        this.cancelRequests(context)
        this.contexts.delete(transferId)
        if (--context.batch.remaining <= 0) this.batches.delete(batchKey)
      },
    }
  }

  respond(ownerId: number, requestId: string, decision: UploadConflictDecision) {
    const req = this.requests.get(requestId)
    if (!req || req.context.owner.id !== ownerId || this.visible.get(ownerId) !== requestId) return
    if (!decision || !['rename', 'overwrite', 'skip', 'cancel'].includes(decision.action)) return
    if (decision.action === 'cancel') {
      req.context.batch.cancelled = true
      for (const context of this.contexts.values()) {
        if (context.batch !== req.context.batch) continue
        this.cancelRun(context.transferId)
        this.cancelRequests(context)
      }
      return
    }
    if (decision.applyToAll === true) req.context.batch.strategy = decision.action
    this.finish(req, decision.action)
    this.pump(ownerId)
  }

  cancelTransfer(transferId: string) {
    const context = this.contexts.get(transferId)
    if (!context) return
    context.cancelled = true
    this.cancelRequests(context)
  }

  cancelSession(sessionId: string) {
    for (const context of this.contexts.values()) {
      if (context.sessionId === sessionId) this.cancelTransfer(context.transferId)
    }
  }

  cancelOwner(ownerId: number) {
    for (const context of this.contexts.values()) {
      if (context.owner.id !== ownerId) continue
      this.cancelRun(context.transferId)
      this.cancelTransfer(context.transferId)
    }
    for (const [key] of this.batches) {
      if (JSON.parse(key)[0] === ownerId) this.batches.delete(key)
    }
  }

  private cancelRequests(context: Context) {
    for (const req of [...this.requests.values()]) {
      if (req.context === context) this.finish(req)
    }
    this.pump(context.owner.id)
  }

  private finish(req: Request, action?: TransferConflictStrategy) {
    this.requests.delete(req.payload.requestId)
    req.cleanup()
    const { owner } = req.context
    if (this.visible.get(owner.id) === req.payload.requestId) {
      this.visible.delete(owner.id)
      if (!owner.isDestroyed()) owner.send('sftp:uploadConflict', null)
    }
    if (action) req.resolve(action)
    else req.reject(new TransferCancelledError())
  }

  private pump(ownerId: number) {
    if (this.visible.has(ownerId)) return
    for (const req of [...this.requests.values()]) {
      const ctx = req.context
      if (ctx.owner.id !== ownerId) continue
      if (ctx.cancelled || ctx.batch.cancelled || ctx.owner.isDestroyed()) {
        this.finish(req)
      } else if (ctx.batch.strategy) {
        this.finish(req, ctx.batch.strategy)
      } else {
        this.visible.set(ownerId, req.payload.requestId)
        ctx.owner.send('sftp:uploadConflict', req.payload)
        return
      }
    }
  }
}
