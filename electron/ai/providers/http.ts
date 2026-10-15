import { t } from '../../i18n'

export function normalizeAiBaseUrl(baseUrl: string): string {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) {
    throw new Error('Invalid AI base URL')
  }

  let parsed: URL
  try {
    parsed = new URL(baseUrl.trim())
  } catch {
    throw new Error('Invalid AI base URL')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('AI base URL must use http or https')
  }

  return parsed.toString().replace(/\/$/, '')
}

export async function readHttpErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json()
    return data?.error?.message || data?.message || fallback
  } catch {
    return fallback
  }
}

export async function readAiStream(response: Response, onEvent: (event: any) => void, strictJson = false): Promise<boolean> {
  if (!response.body) throw new Error(t('ai.noStreamBody'))
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const processEvent = (event: string): boolean => {
    const dataLines = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
    if (dataLines.length === 0) return false
    const payload = dataLines.join('\n')
    if (payload === '[DONE]') return true
    let parsed: unknown
    try {
      parsed = JSON.parse(payload)
    } catch (error) {
      if (strictJson) throw error
      // Ignore non-JSON keepalive/provider diagnostics.
      return false
    }
    onEvent(parsed)
    return false
  }

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) {
        buffer += decoder.decode()
        break
      }
      buffer += decoder.decode(value, { stream: true })
      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() || ''

      for (const event of events) {
        if (processEvent(event)) return true
      }
    }
    return buffer.trim() ? processEvent(buffer) : false
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
