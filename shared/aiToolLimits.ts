export const DEFAULT_AI_TOOL_ROUNDS = 50
export const MAX_AI_TOOL_ROUNDS = 200
export const MAX_AI_TOOL_CALLS_PER_ROUND = 32

/** Persistence ceilings derived from the public tool-round limit, never lower hidden limits. */
export const MAX_AI_TOOL_CALLS_PER_TURN = MAX_AI_TOOL_ROUNDS * MAX_AI_TOOL_CALLS_PER_ROUND
export const MAX_AI_TURN_API_MESSAGES = MAX_AI_TOOL_ROUNDS * (1 + MAX_AI_TOOL_CALLS_PER_ROUND) + 1
export const MAX_AI_TURN_SEGMENTS = MAX_AI_TOOL_ROUNDS * (2 + MAX_AI_TOOL_CALLS_PER_ROUND) + 1

/** Maximum tool-call rounds for one user message; a round may contain multiple calls. */
export function normalizeAiToolRounds(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_AI_TOOL_ROUNDS, Math.floor(n))) : DEFAULT_AI_TOOL_ROUNDS
}
