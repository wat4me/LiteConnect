import { describe, expect, it } from 'vitest'
import { decodeAiSessionStore } from './historyCodec'
import { normalizeSessionStore } from './historyModel'

const user = { id: 'u', role: 'user', content: 'question', createdAt: 1 }
const assistant = { id: 'a', role: 'assistant', content: 'answer', createdAt: 2 }

describe('AI history decoding without database access', () => {
  it.each([undefined, '', '  '])('creates a draft for an empty stored value: %s', stored => {
    const result = decodeAiSessionStore(stored)
    expect(result.created).toBe(true)
    expect(result.rawThreadCount).toBeNull()
    expect(result.store.defaultContextFiles).toEqual([])
    expect(result.store.threads[0].contextFiles).toEqual([])
  })

  it('accepts both object and serialized current stores and reports counts before pruning', () => {
    const raw = {
      version: 1, activeThreadId: 'active', defaultContextFiles: [],
      threads: [
        { id: 'active', messages: [user, assistant], contextFiles: [] },
        { id: 'empty', messages: [], contextFiles: [] },
      ],
    }
    for (const stored of [raw, JSON.stringify(raw)]) {
      const result = decodeAiSessionStore(stored)
      expect(result.rawThreadCount).toBe(2)
      expect(result.rawMessageCount).toBe(2)
      expect(result.store.threads.map(thread => thread.id)).toEqual(['active'])
      expect(result.store.threads[0].messages.map(message => message.id)).toEqual(['u', 'a'])
    }
  })

  it('migrates a single old message to a complete current store', () => {
    const { store, rawMessageCount } = decodeAiSessionStore(JSON.stringify(user))
    expect(rawMessageCount).toBe(1)
    expect(store.defaultContextFiles).toEqual([])
    expect(store.threads[0].contextFiles).toEqual([])
    expect(store.threads[0].title).toBe('question')
    expect(store.threads[0]).not.toHaveProperty('titleGenerated')
  })

  it('keeps the last legacy checkpoint per message and sorts by creation time', () => {
    const lines = [assistant, user, { ...assistant, content: 'final answer' }].map(item => JSON.stringify(item))
    const { store, rawMessageCount } = decodeAiSessionStore(lines.join('\n'))
    expect(rawMessageCount).toBe(2)
    expect(store.threads[0].messages.map(message => message.content)).toEqual(['question', 'final answer'])
  })

  it('recovers multiline legacy records with braces and escaped quotes in content', () => {
    const record = { ...user, content: 'look at {"value": "quoted"} and \\path' }
    const { store } = decodeAiSessionStore(`invalid old header\n${JSON.stringify(record, null, 2)}\n{broken}`)
    expect(store.threads[0].messages[0].content).toBe(record.content)
  })

  it('applies retention during decoding and drops checkpoints whose source was removed', () => {
    const raw = {
      version: 1, activeThreadId: 'active',
      threads: [{
        id: 'active', messages: [user, ...Array.from({ length: 20 }, (_, i) => ({ ...assistant, id: `a${i}`, createdAt: i + 2 })), { ...user, id: 'new', createdAt: 22 }],
        contextCheckpoint: { version: 1, summary: 'summary', throughMessageId: 'u', sourceTokens: 100, summaryTokens: 10 },
      }],
    }
    const result = decodeAiSessionStore(raw, { maxMessages: 20 })
    expect(result.rawMessageCount).toBe(22)
    expect(result.store.threads[0].messages.map(message => message.id)).toEqual(['new'])
    expect(result.store.threads[0].contextCheckpoint).toBeUndefined()
    expect(normalizeSessionStore(result.store)).toEqual(result.store)
  })
})
