import { t } from '../../i18n'
import type { AiChatFailure } from '../../../shared/types/ai'

export class AiProviderError extends Error {
  constructor(readonly failure: AiChatFailure) {
    super(failure.detail)
  }
}

function transportError(kind: 'request' | 'response', error: unknown): unknown {
  if (!(error instanceof Error) || error.name === 'AbortError') return error
  const cause = error.cause as { code?: unknown } | undefined
  const code = cause?.code ?? (error as Error & { code?: unknown }).code
  return new AiProviderError({
    kind,
    detail: error.message,
    code: typeof code === 'string' && /^[A-Z][A-Z_0-9]{0,79}$/.test(code) ? code : undefined,
  })
}

export async function fetchAiResponse(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    throw init.signal?.aborted ? error : transportError('request', error)
  }
}

export async function readAiResponseJson(response: Response): Promise<unknown> {
  try {
    return await response.json()
  } catch (error) {
    throw transportError('response', error)
  }
}

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
    const detail = data?.error?.message || data?.message
    return typeof detail === 'string' && detail.trim() ? detail : fallback
  } catch {
    return fallback
  }
}

export async function readAiStream(response: Response, onEvent: (event: any) => void, strictJson = false): Promise<boolean> {
  if (!response.body) throw new AiProviderError({ kind: 'response', detail: t('ai.noStreamBody') })
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
      const { value, done } = await reader.read().catch(error => { throw transportError('response', error) })
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
