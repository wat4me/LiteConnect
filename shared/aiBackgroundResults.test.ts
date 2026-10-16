import { expect, it } from 'vitest'
import { aiBackgroundResultNotices, AI_BACKGROUND_RESULT_PREFIX } from './aiBackgroundResults'
import { flattenConversationForApi } from './aiMessages'
import { aiHistoryRecordForSummary } from './aiCompaction'
import type { AiHistoryRecord } from './types/ai'

const first = `${AI_BACKGROUND_RESULT_PREFIX}\n[{"jobId":"a","stdout":"disk: 20%"}]`
const second = `${AI_BACKGROUND_RESULT_PREFIX}\n[{"jobId":"b","stdout":"memory: 35%"}]`

it.each(['completed', 'error', 'aborted'] as const)('keeps every injected batch once for display, replay and compaction after %s', status => {
  const record: AiHistoryRecord = {
    id: 'reply', role: 'assistant', createdAt: 1, content: 'Result summary', backgroundNotice: first, status,
    apiMessages: [{ role: 'user', content: first }, { role: 'assistant', content: 'First result analyzed.' },
      { role: 'user', content: second }, { role: 'assistant', content: 'Second result analyzed.' }],
  }
  expect(aiBackgroundResultNotices(record)).toEqual([first, second])
  expect(flattenConversationForApi([record]).filter(message => message.role === 'user').map(message => message.content)).toEqual([first, second])
  const summary = aiHistoryRecordForSummary(record, 4000)!.content
  expect(summary).toContain('disk: 20%')
  expect(summary).toContain('memory: 35%')
  expect(summary.split('disk: 20%')).toHaveLength(2)
  if (status !== 'completed') expect(summary).not.toContain('Result summary')
})

it('keeps the initial idle wakeup separate from later injections without duplicating either', () => {
  const record: AiHistoryRecord = { id: 'reply', role: 'assistant', createdAt: 1, content: 'done', status: 'completed', backgroundNotice: first,
    apiMessages: [{ role: 'assistant', content: 'working' }, { role: 'user', content: second }, { role: 'assistant', content: 'done' }],
  }
  expect(aiBackgroundResultNotices(record)).toEqual([first, second])
  expect(flattenConversationForApi([record]).filter(message => message.role === 'user').map(message => message.content)).toEqual([first, second])
})
