import { MCP_MAX_STDERR_CHARS, MCP_MAX_STDOUT_CHARS } from './limits'

const TRUNCATE_MARK = '\n…[truncated]\n'

const REDACT_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, label: '[redacted-private-key]' },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, label: '[redacted-access-key]' },
  { re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, label: '[redacted-token]' },
  { re: /\b(sk|rk)-[A-Za-z0-9]{16,}\b/g, label: '[redacted-secret]' },
  { re: /\bBearer\s+[A-Za-z0-9._\-+=/]{12,}/gi, label: 'Bearer [redacted]' },
  { re: /\b(api[_-]?key|token|secret|password|passwd|authorization)\s*[:=]\s*\S+/gi, label: '$1=[redacted]' },
]

export function redactSecrets(text: string): string {
  if (!text) return text
  let out = text
  for (const rule of REDACT_PATTERNS) {
    out = out.replace(rule.re, rule.label)
  }
  return out
}

export function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false }
  const keep = Math.max(0, maxChars - TRUNCATE_MARK.length)
  return { text: text.slice(0, keep) + TRUNCATE_MARK, truncated: true }
}

export function capExecOutput(
  stdout: string,
  stderr: string,
  limits: { stdout?: number; stderr?: number } = {},
): { stdout: string; stderr: string; truncated: boolean } {
  const stdoutLimit = limits.stdout ?? MCP_MAX_STDOUT_CHARS
  const stderrLimit = limits.stderr ?? MCP_MAX_STDERR_CHARS
  const redactedOut = redactSecrets(stdout)
  const redactedErr = redactSecrets(stderr)
  const out = truncateText(redactedOut, stdoutLimit)
  const err = truncateText(redactedErr, stderrLimit)
  return {
    stdout: out.text,
    stderr: err.text,
    truncated: out.truncated || err.truncated,
  }
}

export function capCollectedStream(current: string, chunk: string, hardCap: number): { text: string; truncated: boolean } {
  if (current.length >= hardCap) return { text: current, truncated: true }
  if (current.length + chunk.length <= hardCap) return { text: current + chunk, truncated: false }
  return { text: current + chunk.slice(0, hardCap - current.length), truncated: true }
}
