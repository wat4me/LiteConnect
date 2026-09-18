import { MCP_MAX_STDERR_CHARS, MCP_MAX_STDOUT_CHARS } from './limits'

const TRUNCATE_MARK = '\n…[truncated]\n'

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
  const out = truncateText(stdout, stdoutLimit)
  const err = truncateText(stderr, stderrLimit)
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
