export const DEFAULT_AI_HISTORY_MAX_THREADS = 50
export const MIN_AI_HISTORY_MAX_THREADS = 1
export const MAX_AI_HISTORY_MAX_THREADS = 200

export const DEFAULT_AI_HISTORY_MAX_MESSAGES = 200
export const MIN_AI_HISTORY_MAX_MESSAGES = 20
export const MAX_AI_HISTORY_MAX_MESSAGES = 2000

function normalizeInteger(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.floor(value)))
}

export function normalizeAiHistoryMaxThreads(raw: unknown): number {
  return normalizeInteger(
    raw,
    DEFAULT_AI_HISTORY_MAX_THREADS,
    MIN_AI_HISTORY_MAX_THREADS,
    MAX_AI_HISTORY_MAX_THREADS,
  )
}

export function normalizeAiHistoryMaxMessages(raw: unknown): number {
  return normalizeInteger(
    raw,
    DEFAULT_AI_HISTORY_MAX_MESSAGES,
    MIN_AI_HISTORY_MAX_MESSAGES,
    MAX_AI_HISTORY_MAX_MESSAGES,
  )
}

export type AiHistoryLimits = {
  maxThreads: number
  maxMessages: number
}

export function normalizeAiHistoryLimits(raw?: {
  maxThreads?: unknown
  maxMessages?: unknown
}): AiHistoryLimits {
  return {
    maxThreads: normalizeAiHistoryMaxThreads(raw?.maxThreads),
    maxMessages: normalizeAiHistoryMaxMessages(raw?.maxMessages),
  }
}
