export const DEFAULT_AI_TOOL_ROUNDS = 50
export const MAX_AI_TOOL_ROUNDS = 200

/** Maximum tool-call rounds for one user message; a round may contain multiple calls. */
export function normalizeAiToolRounds(value: unknown): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_AI_TOOL_ROUNDS, Math.floor(n))) : DEFAULT_AI_TOOL_ROUNDS
}
