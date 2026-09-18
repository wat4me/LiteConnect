/** Strip CSI / OSC for pattern matching on terminal output. */
export function stripAnsiForHistory(text: string): string {
  return String(text || '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
}

/**
 * Heuristic: remote output looks like a failed / invalid command invocation.
 * Used to avoid polluting shell command history with typos like `docker p`.
 * Prefer false negatives (still record) over false positives (drop good cmds).
 */
export function looksLikeFailedShellOutput(raw: string): boolean {
  const s = stripAnsiForHistory(raw)
  if (!s.trim()) return false

  // docker / CLI subcommand style: "docker: 'p' is not a docker command."
  if (/\bis not a [\w.-]+ command\b/i.test(s)) return true
  if (/\bis not a valid command\b/i.test(s)) return true

  // shells
  if (/:\s*command not found\b/i.test(s)) return true
  if (/\bcommand not found:\s*\S+/i.test(s)) return true
  if (/\bUnknown command[:\s]/i.test(s)) return true
  if (/\bno such command\b/i.test(s)) return true

  // getopt-style
  if (/\bunrecognized (option|argument|command)\b/i.test(s)) return true
  if (/\binvalid option\b/i.test(s)) return true
  if (/\billegal option\b/i.test(s)) return true
  if (/\bunknown (option|flag|command)\b/i.test(s)) return true

  // git / kubectl style
  if (/\bis not a git command\b/i.test(s)) return true
  if (/\bis not a kubectl\b/i.test(s)) return true
  if (/\berror:\s*unknown command\b/i.test(s)) return true

  return false
}
