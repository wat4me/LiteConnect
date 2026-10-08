import { describe, expect, it } from 'vitest'
import { advanceChatActivity, chatActivityDisplay, type AiChatActivity } from './chatActivity'

const initial: AiChatActivity = { phase: 'requesting', phaseStartedAt: 1000, lastActivityAt: 1000 }

describe('AI activity from real stream events', () => {
  it('distinguishes request, accepted stream, actual thought and answer deltas', () => {
    let state = advanceChatActivity(initial, { type: 'model-status', value: 'waiting' }, 2000)
    expect(state.phase).toBe('waiting')
    state = advanceChatActivity(state, { type: 'reasoning', value: 'checking' }, 3000)
    expect(state.phase).toBe('reasoning')
    state = advanceChatActivity(state, { type: 'reasoning', value: ' disk' }, 4000)
    expect(state.phaseStartedAt).toBe(3000)
    expect(state.lastActivityAt).toBe(4000)
    state = advanceChatActivity(state, { type: 'content', value: 'answer' }, 5000)
    expect(state.phase).toBe('responding')
    expect(state.phaseStartedAt).toBe(5000)
  })

  it('never labels silence as continuing thought or resets silence for usage', () => {
    const thinking = advanceChatActivity(initial, { type: 'reasoning', value: 'plan' }, 2000)
    const state = advanceChatActivity(thinking, { type: 'usage', value: {} }, 20000)
    expect(state).toBe(thinking)
    expect(chatActivityDisplay(state, 10000)).toMatchObject({ phase: 'waiting', elapsedSeconds: 8, delayed: false })
    expect(chatActivityDisplay(state, 32000)).toMatchObject({ phase: 'waiting', quietSeconds: 30, delayed: true })
    expect(advanceChatActivity(state, { type: 'reasoning', value: '' }, 32000)).toBe(state)
  })

  it('prioritizes pending approvals and running tools without false model-delay warnings', () => {
    const event = { type: 'tool' as const, value: { id: 'a', name: 'exec', phase: 'ask' as const } }
    const approval = advanceChatActivity(initial, event, 2000, [{ status: 'running' }, { status: 'ask' }])
    expect(chatActivityDisplay(approval, 90000)).toMatchObject({ phase: 'approval', delayed: false })
    const running = advanceChatActivity(approval, event, 91000, [{ status: 'running' }])
    expect(running.phase).toBe('tool')
    const finished = advanceChatActivity(running, event, 92000, [{ status: 'done' }])
    expect(finished.phase).toBe('waiting')
    expect(chatActivityDisplay(finished, 122000).delayed).toBe(true)
  })

  it('tracks context preparation and streamed tool arguments as their own phases', () => {
    const compacting = advanceChatActivity(initial, {
      type: 'compaction', value: { phase: 'start', beforeTokens: 100, budgetTokens: 100 },
    }, 2000)
    expect(chatActivityDisplay(compacting, 90000).delayed).toBe(false)
    const toolInput = advanceChatActivity(compacting, { type: 'model-status', value: 'tool-input' }, 91000)
    expect(toolInput.phase).toBe('tool-input')
    expect(chatActivityDisplay(toolInput, 100000).phase).toBe('waiting')
  })
})

it('does not mislabel a slow remote diff preview as model silence', () => {
  const preparation = advanceChatActivity(initial, { type: 'model-status', value: 'tool-prepare' }, 2000)
  expect(chatActivityDisplay(preparation, 92000)).toMatchObject({
    phase: 'tool-prepare', elapsedSeconds: 90, delayed: false,
  })
  const approval = advanceChatActivity(preparation, {
    type: 'tool', value: { id: 'edit', name: 'edit_file', phase: 'ask' },
  }, 92000, [{ status: 'ask' }])
  expect(approval.phase).toBe('approval')
})
