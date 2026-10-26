export const AI_COMMAND_RESULT_MAX = 20_000
type Payload = Record<string, unknown>

/** Bound the fields before encoding; never cut a serialized JSON document. */
export function serializeAiCommandResult(raw: Payload): string {
  const payload: Payload = {}
  let truncated = raw.truncated === true
  const text = (key: string, limit: number, keepEmpty = false) => {
    const value = raw[key]
    if (typeof value !== 'string' || (!value && !keepEmpty)) return
    payload[key] = value.slice(0, limit)
    truncated ||= value.length > limit
  }
  if (raw.exitCode === null || (typeof raw.exitCode === 'number' && Number.isFinite(raw.exitCode))) payload.exitCode = raw.exitCode
  for (const key of ['jobId', 'sessionId', 'connectionId', 'status', 'signal', 'code']) text(key, 100)
  text('connectionName', 500)
  text('command', 500)
  for (const key of ['startedAt', 'finishedAt']) {
    if (typeof raw[key] === 'number' && Number.isFinite(raw[key])) payload[key] = raw[key]
  }
  text('stdout', AI_COMMAND_RESULT_MAX - 240, true)
  text('stderr', 2_000)
  text('error', 2_000)
  text('message', 2_000)
  if (truncated) payload.truncated = true
  let content = JSON.stringify(payload)
  while (content.length > AI_COMMAND_RESULT_MAX) {
    const key = ['stdout', 'stderr', 'error', 'message'].reduce((largest, key) =>
      String(payload[key] || '').length > String(payload[largest] || '').length ? key : largest, 'stdout')
    payload[key] = String(payload[key] || '').slice(0, Math.floor(String(payload[key] || '').length * 0.8))
    payload.truncated = true
    content = JSON.stringify(payload)
  }
  return content
}

/** Legacy command records could be cut after their leading exitCode field. */
export function readAiCommandResult(content: string): Payload | undefined {
  const bounded = content.slice(0, AI_COMMAND_RESULT_MAX)
  if (content.length <= AI_COMMAND_RESULT_MAX) {
    try {
      const value: unknown = JSON.parse(content)
      if (value && typeof value === 'object' && !Array.isArray(value)) return value as Payload
    } catch { /* Recover only the known legacy metadata prefix below. */ }
  }
  const match = /^\s*\{\s*"exitCode"\s*:\s*(null|-?\d+)\s*,/.exec(bounded)
  if (!match) return undefined
  const exitCode = match[1] === 'null' ? null : Number(match[1])
  return exitCode === null || Number.isFinite(exitCode) ? { exitCode, truncated: true } : undefined
}
