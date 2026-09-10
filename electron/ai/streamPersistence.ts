import type { AiChatResult, AiChatStreamOptions, AiChatStreamPayload, AiHistoryRecord } from '../../shared/types/ai'
import { createAssistantCheckpoint } from './assistantCheckpoint'
import { t } from '../i18n'

/** The main process owns the reply. Publishing is only a best-effort UI projection. */
export async function runPersistedAiReply(opts: {
  target: AiChatStreamOptions
  save: (record: AiHistoryRecord) => Promise<void>
  publish: (payload: AiChatStreamPayload) => void
  run: (emit: (payload: AiChatStreamPayload) => void, checkpoint: () => Promise<void>) => Promise<AiChatResult>
}): Promise<AiChatResult> {
  const record: AiHistoryRecord = {
    id: opts.target.assistantMessageId,
    role: 'assistant',
    createdAt: opts.target.createdAt,
    content: '',
    segments: [],
    toolRuns: [],
  }
  const save = () => opts.save(JSON.parse(JSON.stringify(record)) as AiHistoryRecord)
  const checkpoint = createAssistantCheckpoint(save)
  const append = (kind: 'content' | 'reasoning', text: string) => {
    const segments = record.segments!
    const last = segments[segments.length - 1]
    if (last?.kind === kind) last.text += text
    else segments.push({ kind, text })
  }
  const emit = (payload: AiChatStreamPayload) => {
    if (payload.type === 'content') {
      record.content += payload.value
      append('content', payload.value)
    } else if (payload.type === 'reasoning') {
      record.reasoningContent = (record.reasoningContent || '') + payload.value
      append('reasoning', payload.value)
    } else if (payload.type === 'usage') {
      record.usage = payload.value
    } else if (payload.type === 'tool') {
      const incoming = payload.value
      let run = record.toolRuns!.find(r => r.id === incoming.id)
      if (!run) {
        run = { id: incoming.id, name: incoming.name, args: '', content: '', isError: false }
        record.toolRuns!.push(run)
        record.segments!.push({ kind: 'tool', runId: run.id })
      }
      Object.assign(run, {
        name: incoming.name || run.name,
        args: incoming.args ?? run.args,
        content: incoming.content ?? run.content,
        status: incoming.status || (incoming.phase === 'start' ? 'running' : incoming.phase),
        isError: incoming.isError === true || ['denied', 'blocked', 'reclassify'].includes(incoming.phase),
        risk: incoming.risk ?? run.risk,
        reason: incoming.reason ?? run.reason,
        diffSummary: incoming.diffSummary ?? run.diffSummary,
        diffPreview: incoming.diffPreview ?? run.diffPreview,
      })
    }
    if (payload.type !== 'done') checkpoint.schedule(payload.type === 'tool')
    // A destroyed/frozen renderer must never make execution or persistence fail.
    try { opts.publish(payload) } catch { /* UI may have gone away */ }
  }

  let aborted = false
  try {
    await save()
    const reply = await opts.run(emit, checkpoint.flush)
    aborted = reply.aborted === true
    const content = reply.content || record.content || (aborted ? t('ai.stopped') : '')
    if (!record.content && content) append('content', content)
    record.content = content
    record.reasoningContent = reply.reasoningContent || record.reasoningContent
    record.usage = reply.usage || record.usage
    record.apiMessages = reply.apiMessages
    record.error = reply.error === true
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    aborted = (err instanceof Error && err.name === 'AbortError') || /abort|取消|停止/i.test(message)
    if (!aborted) {
      record.error = true
      const suffix = `${record.content ? '\n\n' : ''}${message || t('ai.requestInterrupted')}`
      record.content += suffix
      append('content', suffix)
    } else if (!record.content) {
      record.content = t('ai.stopped')
      append('content', record.content)
    }
  } finally {
    // A terminated request can no longer receive approval, including checkpoint failures.
    for (const run of record.toolRuns || []) {
      if (run.status === 'ask') {
        emit({ type: 'tool', value: {
          id: run.id, name: run.name, phase: 'denied',
          content: 'REQUEST_ENDED: The request ended before this tool was approved; it was not executed.',
          isError: true,
        } })
      }
    }
    await checkpoint.stop()
    await save()
  }
  return {
    content: record.content,
    reasoningContent: record.reasoningContent,
    usage: record.usage,
    toolRuns: record.toolRuns,
    segments: record.segments,
    apiMessages: record.apiMessages,
    error: record.error,
    aborted,
  }
}
