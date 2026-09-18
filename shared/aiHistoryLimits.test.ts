import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AI_HISTORY_MAX_MESSAGES,
  DEFAULT_AI_HISTORY_MAX_THREADS,
  normalizeAiHistoryMaxMessages,
  normalizeAiHistoryMaxThreads,
} from './aiHistoryLimits'

describe('AI history limits', () => {
  it('uses defaults for invalid values', () => {
    expect(normalizeAiHistoryMaxThreads(undefined)).toBe(DEFAULT_AI_HISTORY_MAX_THREADS)
    expect(normalizeAiHistoryMaxMessages('bad')).toBe(DEFAULT_AI_HISTORY_MAX_MESSAGES)
  })

  it('clamps and rounds configured values', () => {
    expect(normalizeAiHistoryMaxThreads(0)).toBe(1)
    expect(normalizeAiHistoryMaxThreads(999)).toBe(200)
    expect(normalizeAiHistoryMaxMessages(1)).toBe(20)
    expect(normalizeAiHistoryMaxMessages(2001.9)).toBe(2000)
  })
})
