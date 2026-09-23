const MAX_EXCLUDE_PATTERNS = 30
const MAX_EXCLUDE_PATTERN_CHARS = 160

/** User rules are case-insensitive shell-style globs (`*` / `?`), not raw regex. */
export function normalizeShellHistoryExcludePatterns(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') continue
    const pattern = item.trim().slice(0, MAX_EXCLUDE_PATTERN_CHARS)
    if (!pattern || result.includes(pattern)) continue
    result.push(pattern)
    if (result.length >= MAX_EXCLUDE_PATTERNS) break
  }
  return result
}

function escapeRegex(text: string): string {
  return text.replace(/[|\\{}()[\]^$+?.*]/g, '\\$&')
}

function globMatches(command: string, pattern: string): boolean {
  const source = escapeRegex(pattern)
    .replace(/\\\*/g, '.*')
    .replace(/\\\?/g, '.')
  try {
    return new RegExp(`^${source}$`, 'iu').test(command)
  } catch {
    return false
  }
}

function isShellReference(value: string): boolean {
  const normalized = value.trim().replace(/^['"]|['"]$/g, '')
  return (
    /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(normalized)
    || /^\$\(.+\)$/.test(normalized)
    || /^%[A-Za-z_][A-Za-z0-9_]*%$/.test(normalized)
  )
}

const SENSITIVE_NAME = '(?:(?:[a-z][a-z0-9]*[_-])*(?:pass(?:word|wd)?|passwd|secret|api[_-]?key|access[_-]?key|token|private[_-]?key|client[_-]?secret))'

/**
 * Conservative credential detector used before shell commands enter local history.
 * It intentionally checks values, not the mere presence of words such as "token".
 */
export function containsSensitiveShellValue(command: string): boolean {
  const text = String(command || '')
  if (!text) return false

  // Common provider token formats. These are distinctive enough to match anywhere.
  const knownTokens = [
    /\bAKIA[0-9A-Z]{16}\b/,
    /\bASIA[0-9A-Z]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
    /\bglpat-[A-Za-z0-9_-]{16,}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/,
    /\bsk-(?:(?:proj|svcacct)-)?[A-Za-z0-9_-]{20,}\b/,
    /\bnpm_[A-Za-z0-9]{20,}\b/,
    /\bAIza[0-9A-Za-z_-]{30,}\b/,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ]
  if (knownTokens.some((pattern) => pattern.test(text))) return true

  // URLs embedding credentials, for example postgres://user:password@host/db.
  if (/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i.test(text)) return true

  // Authorization headers and curl-style user:password authentication.
  const authorization = text.match(/\bauthorization\s*:\s*(?:bearer|basic)\s+([^\s'";|]+)/i)
  if (authorization?.[1] && !isShellReference(authorization[1])) return true
  const sensitiveHeader = text.match(new RegExp(`\\b${SENSITIVE_NAME}\\s*:\\s*([^\\s'";|]+)`, 'i'))
  if (sensitiveHeader?.[1] && !isShellReference(sensitiveHeader[1])) return true
  if (/(?:^|\s)(?:-u|--user)\s+(?:['"])?[^\s:'"]+:[^\s'"]+/i.test(text)) return true

  // NAME=value assignments and --name value / --name=value options.
  const assignment = new RegExp(`(?:^|[\\s;&|])(?:export\\s+)?${SENSITIVE_NAME}\\s*=\\s*([^\\s;&|]+)`, 'ig')
  for (const match of text.matchAll(assignment)) {
    if (match[1] && !isShellReference(match[1])) return true
  }

  const option = new RegExp(`(?:^|\\s)--?${SENSITIVE_NAME}(?:\\s+|=)([^\\s;&|]+)`, 'ig')
  for (const match of text.matchAll(option)) {
    if (match[1] && !isShellReference(match[1])) return true
  }

  // Widely used compact password options: mysql -psecret, sshpass -p secret.
  if (/\bmysql(?:admin|dump)?\b[^\r\n;&|]*\s-p[^\s;&|]+/i.test(text)) return true
  if (/\bsshpass\b[^\r\n;&|]*\s-p\s*[^\s;&|]+/i.test(text)) return true

  return false
}

export function shouldStoreShellCommand(
  command: string,
  customPatterns: readonly string[] = [],
): boolean {
  const raw = String(command || '').replace(/\r?\n/g, ' ')
  if (!raw.trim()) return false
  // Match the established shell convention: a leading space means private history.
  if (/^\s/.test(raw)) return false
  const normalized = raw.trim()
  // Older builds could capture this local terminal status line after an empty Enter.
  // Reject it on both history load and future writes.
  if (/^Connecting to .+\.\.\.$/.test(normalized)) return false
  if (containsSensitiveShellValue(normalized)) return false
  return !normalizeShellHistoryExcludePatterns(customPatterns)
    .some((pattern) => globMatches(normalized, pattern))
}
