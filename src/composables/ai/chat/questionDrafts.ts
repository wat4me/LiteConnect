import type { AiQuestionDraft, AiSessionState } from '@/domain/ai/chat'
import type { AiToolRun } from '@shared/types/ai'

export function createAiQuestionDraft(threadId = '', requestId: string | null = null, args = ''): AiQuestionDraft {
  return { threadId, requestId, args, selected: {}, text: {}, custom: {}, currentIndex: 0 }
}

export function getAiQuestionDraft(state: AiSessionState, run: Pick<AiToolRun, 'id' | 'args'>): AiQuestionDraft {
  const key = JSON.stringify([state.activeThreadId, run.id])
  state.questionDrafts ||= new Map()
  const drafts = state.questionDrafts
  const previous = drafts.get(key)
  if (!previous || previous.requestId !== state.activeRequestId || previous.args !== run.args) {
    drafts.set(key, createAiQuestionDraft(state.activeThreadId, state.activeRequestId, run.args))
  }
  return drafts.get(key)!
}

export function clearAiQuestionDrafts(state: AiSessionState, threadId: string): void {
  for (const [key, draft] of state.questionDrafts || []) {
    if (draft.threadId === threadId) state.questionDrafts!.delete(key)
  }
}

/** Called by the chat facade even when no question component is mounted. */
export function pruneAiQuestionDrafts(state: AiSessionState): void {
  if (!state.questionDrafts?.size) return
  const pending = new Map(state.messages.filter(message => message.streaming)
    .flatMap(message => (message.toolRuns || []).filter(run => run.status === 'question').map(run => [run.id, run.args] as const)))
  for (const [key, draft] of state.questionDrafts) {
    if (draft.threadId !== state.activeThreadId) continue
    const runId = (JSON.parse(key) as string[])[1]
    if (!state.loading || draft.requestId !== state.activeRequestId || pending.get(runId) !== draft.args) state.questionDrafts.delete(key)
  }
}
