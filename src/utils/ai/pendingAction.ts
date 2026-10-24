import type { AiSessionState } from '@/domain/ai/chat'

export type AiPendingAction = 'approval' | 'question' | 'mixed'

/** Only a live request can require action; historical tool statuses are not pending work. */
export function getAiPendingAction(state: Pick<AiSessionState, 'loading' | 'messages'>): AiPendingAction | null {
  if (!state.loading) return null
  let approval = false
  let question = false
  for (const message of state.messages) {
    if (!message.streaming) continue
    for (const run of message.toolRuns || []) {
      approval ||= run.status === 'ask'
      question ||= run.status === 'question'
      if (approval && question) return 'mixed'
    }
  }
  return approval ? 'approval' : question ? 'question' : null
}
