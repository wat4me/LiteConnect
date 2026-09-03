const SECRET_KEYS = new Set(['password', 'privateKey', 'jumpPassword', 'jumpPrivateKey'])

export function redactToolArgsRecord(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...args }
  for (const key of SECRET_KEYS) {
    if (typeof out[key] === 'string' && out[key]) out[key] = '***'
  }
  return out
}

/** Strip secrets from a tool-call JSON argument string before UI / history. */
export function redactToolArgsJson(raw: string): string {
  const text = typeof raw === 'string' ? raw : ''
  if (!text) return text
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return JSON.stringify(redactToolArgsRecord(parsed as Record<string, unknown>))
    }
  } catch {
    if (/password|privateKey/i.test(text)) return '{"redacted":true}'
  }
  return text
}
