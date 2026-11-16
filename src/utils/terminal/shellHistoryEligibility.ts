/** Strip CSI / OSC for pattern matching on terminal output. */
export function stripAnsiForHistory(text: string): string {
  return String(text || '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[()][0-9A-Za-z]/g, '')
}

/** Errors print at once; only the start of the output is inspected so later log lines cannot veto a command. */
const OUTPUT_HEAD_CHARS = 4000

/**
 * Output produced after Enter, without the rest of the echoed command line.
 * Keeps patterns from matching text the user typed (e.g. `grep "not found"`).
 */
export function commandOutputAfterEcho(raw: string, command: string): string {
  const text = stripAnsiForHistory(raw).replace(/\r\n?/g, '\n')
  const newline = text.indexOf('\n')
  if (newline === -1) return command && text.includes(command.trim()) ? '' : text
  const firstLine = text.slice(0, newline)
  const echoed = !firstLine.trim() || (!!command && command.trim().includes(firstLine.trim()))
    || (!!command && firstLine.includes(command.trim()))
  return echoed ? text.slice(newline + 1) : text
}

/**
 * Line-anchored messages printed by shells and command-line tools when the
 * invocation itself is wrong: unknown command, missing path, bad option,
 * syntax error, usage text. A command whose output starts like this is not
 * worth suggesting again. Runtime failures of valid commands (network errors,
 * failing builds) are deliberately not matched.
 */
const FAILURE_PATTERNS: RegExp[] = [
  // Unknown command (bash, zsh, fish, sh, busybox, PowerShell-like shells)
  /:\s*command not found\b/i,
  /\bcommand not found:\s*\S+/i,
  /^\s*(?:-?\w*sh|fish):[^\n]*(?:未找到命令|找不到命令|命令未找到)/im,
  /^[^\n]*:\s*not found\s*$/im,
  /\bUnknown command[:\s]/i,
  /\bno such command\b/i,
  /\bis not (?:a|an) [\w.-]+ command\b/i,
  /\bis not a valid command\b/i,
  /\berror:\s*unknown (?:command|subcommand)\b/i,
  /\bunknown (?:command|subcommand)\b/i,
  // Wrong paths and permissions (shell builtins and coreutils style "prog: path: reason")
  /^[^\n]*:\s*No such file or directory\s*$/im,
  /^[^\n]*:\s*(?:没有那个文件或目录|没有该文件或目录)\s*$/im,
  /^[^\n]*:\s*Not a directory\s*$/im,
  /^[^\n]*:\s*(?:不是目录)\s*$/im,
  /^[^\n]*:\s*Permission denied\s*$/im,
  /^[^\n]*:\s*(?:权限不够|拒绝访问)\s*$/im,
  /^[^\n]*:\s*Is a directory\s*$/im,
  /\bcannot access\b[^\n]*:\s*No such file/i,
  /\bUnit \S+ (?:could not be found|not found)\b/i,
  /\bUnable to locate package\b/i,
  // Shell syntax
  /\bsyntax error\b/i,
  /:\s*(?:语法错误)/,
  /\bevent not found\b/i,
  /\bunexpected EOF while looking for matching\b/i,
  /\bbad substitution\b/i,
  // Option parsing and usage text
  /\bunrecognized (?:option|argument|command)\b/i,
  /\b(?:invalid|illegal|unknown) (?:option|flag|argument)\b/i,
  /\bmissing (?:file )?operand\b/i,
  /\boption requires an argument\b/i,
  /\brequires at least \d+ arguments?\b/i,
  /^\s*usage:\s/im,
  /^\s*用法[:：]/m,
  /\bTry '[^']+ --help' for more information\b/i,
  /请尝试执行\s*["“][^"”]+--help["”]/,
  /(?:无效的|未识别的|不可识别的|未知的)选项/,
  /缺少(?:了)?(?:文件)?操作对象/,
  // git / kubectl / docker style
  /\bis not a git command\b/i,
  /\bis not a kubectl\b/i,
  /\bunknown shorthand flag\b/i,
]

/**
 * Heuristic: remote output looks like a failed / invalid command invocation.
 * Used to avoid polluting shell command history with typos like `docker p`.
 */
export function looksLikeFailedShellOutput(raw: string): boolean {
  const s = stripAnsiForHistory(raw).replace(/\r\n?/g, '\n').slice(0, OUTPUT_HEAD_CHARS)
  if (!s.trim()) return false
  return FAILURE_PATTERNS.some((pattern) => pattern.test(s))
}

/** Character that ends a shell prompt (`$`, `#`, `%`, `❯`…), taken from the prompt seen before typing. */
export function promptTerminator(prompt: string): string {
  const match = /([$#%>❯➜λ»])\s*$/.exec(prompt || '')
  return match?.[1] ?? ''
}

/**
 * The shell printed its prompt again after the command's output: the command
 * has finished. Prompts change (directory, git branch), so only the terminator
 * of the earlier prompt is compared.
 */
export function endsWithShellPrompt(output: string, terminator: string): boolean {
  if (!terminator) return false
  const text = stripAnsiForHistory(output).replace(/\r\n?/g, '\n')
  const lastLine = text.slice(text.lastIndexOf('\n') + 1)
  const trimmed = lastLine.trimEnd()
  return trimmed.length > 1 && trimmed.endsWith(terminator) && lastLine.length > trimmed.length
}
