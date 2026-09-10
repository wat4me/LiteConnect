/**
 * Bash source → flat command list, via a tree-sitter AST.
 *
 * Why an AST instead of splitting on `;`, `&&` and `|`:
 * - `cat $(rm -rf ~)` hides a second command inside a command substitution.
 *   Text splitting never sees it.
 * - `grep -rn "rm -rf" src/` only *looks* dangerous because the words sit in a
 *   string literal. Text splitting cannot tell a literal from a command.
 * The AST gets both right: it hands us the real command nodes, and we can blank
 * out string literals before running text heuristics.
 *
 * This module is deliberately pure — it never loads a parser, it is handed a
 * `parse` callback. The wasm-backed parser lives in electron/mcp/bashParser.ts.
 */

/** Structural subset of a tree-sitter SyntaxNode, so this file stays parser-agnostic. */
export type BashSyntaxNode = {
  type: string
  text: string
  startIndex: number
  endIndex: number
  hasError?: boolean
  childForFieldName?(name: string): BashSyntaxNode | null
  children: ReadonlyArray<BashSyntaxNode | null>
}

export type BashParseFn = (source: string) => BashSyntaxNode | null

/** `bash -c "bash -c 'rm -rf /'"` is two levels; four is plenty and bounds the work. */
export const BASH_PARSE_MAX_DEPTH = 4

export type BashCommandOrigin =
  | 'root'
  | 'subshell'
  | 'command-substitution'
  | 'process-substitution'
  | 'shell-c'
  | 'shell-heredoc'
  | 'eval'
  | 'wrapper'

export type BashFlatCommand = {
  /** basename of the command word, lowercased; empty for a bare assignment */
  binary: string
  /** argument source text, quotes kept */
  args: string[]
  /** command name came from an expansion (`$X -rf /`) — the target is unknowable */
  dynamicName: boolean
  origin: BashCommandOrigin
  /** we already re-parsed the code this token runs, so the wrapper carries no risk of its own */
  expanded: boolean
  /** behaviour that cannot be decided statically, already phrased for the user */
  opaqueReason: string | null
  text: string
  /** `text` with string-literal contents blanked out */
  maskedText: string
}

export type BashParseResult = {
  commands: BashFlatCommand[]
  /** `>` / `>>` / `&>` destinations that are not /dev/null — a real write */
  writeTargets: string[]
  /** `<` destinations: the command's *input* comes from a file we cannot read */
  readTargets: string[]
  /** string-literal-free text from every recursion level, for the "forbidden" regex pass */
  forbiddenHaystack: string[]
  /** constructs whose behaviour cannot be decided statically → fail closed */
  opaque: string[]
  parseErrors: number
  depthExceeded: boolean
}

const LITERAL_NODE_TYPES = new Set([
  'raw_string',
  'string',
  'ansi_c_string',
  'translated_string',
  'heredoc_body',
])

/** Children of a `command` node that are not arguments to the command itself. */
const NON_ARGUMENT_NODE_TYPES = new Set([
  'command_name',
  'variable_assignment',
  'file_redirect',
  'heredoc_redirect',
  'redirect',
])

const SHELL_BINARIES = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'csh', 'tcsh', 'fish'])

const PRIVILEGE_WRAPPERS = new Set(['sudo', 'doas', 'pkexec', 'su', 'runuser'])

/**
 * Wrappers that simply hand control to the next token. Their own flags carry no
 * meaning for us, so we strip a conservative prefix and re-parse what is left.
 * Both under- and over-stripping end up failing closed: either the inner command
 * is still found, or the wrapper itself is reported as opaque.
 */
const TRANSPARENT_WRAPPERS = new Set([
  'env',
  'nohup',
  'time',
  'timeout',
  'nice',
  'ionice',
  'setsid',
  'stdbuf',
  'command',
  'builtin',
  'exec',
  'xargs',
])

/** Transparent wrappers that do something harmless when given no command at all. */
const HARMLESS_ALONE_WRAPPERS = new Set(['env', 'time', 'command', 'builtin'])

/** Flags that consume the following token as their value. */
const WRAPPER_VALUE_FLAGS = new Set([
  '-u',
  '-g',
  '-p',
  '-C',
  '-T',
  '-r',
  '-t',
  '-s',
  '-k',
  '-I',
  '-d',
  '-E',
  '-P',
  '-L',
  '-a',
  '-f',
  '-w',
  '-o',
  '-e',
])

/** `command -v ls` prints a path instead of running it. */
const WRAPPER_QUERY_ONLY_FLAGS = new Set(['-v', '-V'])

const SOURCE_BUILTINS = new Set(['source', '.'])

/**
 * `2>&1`, `1>&2`, `>&2`, `0<&3`, `2>&-` duplicate or close a descriptor; none of
 * them names a file.
 */
const FD_DUPLICATION_OPERATORS = new Set(['>&', '>&-', '<&', '<&-'])

/** A bare `2>&1`, `1>&2`, `2>/dev/null` is not a write to anything durable. */
const HARMLESS_REDIRECT_TARGETS = new Set(['/dev/null', '/dev/stdout', '/dev/stderr', '-'])

const CONTEXT_BY_NODE_TYPE: Record<string, BashCommandOrigin> = {
  command_substitution: 'command-substitution',
  process_substitution: 'process-substitution',
  subshell: 'subshell',
}

type Range = { start: number; end: number }
type Recursion = { code: string; origin: BashCommandOrigin }

export function flattenBashCommand(parse: BashParseFn, command: string): BashParseResult {
  const out: BashParseResult = {
    commands: [],
    writeTargets: [],
    readTargets: [],
    forbiddenHaystack: [],
    opaque: [],
    parseErrors: 0,
    depthExceeded: false,
  }
  collect(parse, command, 'root', 0, out)
  return out
}

function collect(
  parse: BashParseFn,
  source: string,
  origin: BashCommandOrigin,
  depth: number,
  out: BashParseResult,
): void {
  if (depth > BASH_PARSE_MAX_DEPTH) {
    out.depthExceeded = true
    out.opaque.push('nested command depth limit reached')
    return
  }
  const root = parse(source)
  if (!root) {
    out.parseErrors += 1
    out.opaque.push('command could not be parsed')
    return
  }
  if (root.hasError) out.parseErrors += 1

  const literals: Range[] = []
  const deferred: Recursion[] = []
  /**
   * A heredoc body is a sibling of the `command` node (both hang off
   * `redirected_statement`), so it is collected on the way down and claimed by
   * the next command node we build.
   */
  let pendingHeredocs: string[] = []

  const visit = (node: BashSyntaxNode, ctx: BashCommandOrigin) => {
    if (node.type === 'redirected_statement') {
      const bodies = heredocBodies(node)
      if (bodies.length) pendingHeredocs.push(...bodies)
    }
    if (LITERAL_NODE_TYPES.has(node.type)) {
      literals.push({ start: node.startIndex, end: node.endIndex })
    }
    if (node.type === 'file_redirect' || node.type === 'redirect') {
      if (!isFdDuplication(node)) {
        const destination = redirectDestination(node)
        if (destination && !isHarmlessRedirect(destination)) {
          // Reading is not writing: `cat < x` feeds stdin, it does not modify x.
          // Keeping the two apart is what stops `cat < /etc/passwd` from being
          // reported as a write to a critical path.
          if (isInputRedirect(node)) out.readTargets.push(destination)
          else out.writeTargets.push(destination)
        }
      }
    }
    if (node.type === 'command') {
      const claimed = pendingHeredocs.length ? pendingHeredocs.splice(0) : []
      const built = buildCommand(node, ctx, claimed)
      out.commands.push(built.command)
      if (built.command.opaqueReason) out.opaque.push(built.command.opaqueReason)
      for (const next of built.recursions) {
        built.command.expanded = true
        deferred.push(next)
      }
      out.forbiddenHaystack.push(built.command.maskedText)
    }
    const childCtx = CONTEXT_BY_NODE_TYPE[node.type] ?? ctx
    for (const child of node.children) {
      if (child) visit(child, childCtx)
    }
  }
  visit(root, origin)

  out.forbiddenHaystack.push(maskRanges(source, literals))
  for (const { code, origin: innerOrigin } of deferred) {
    collect(parse, code, innerOrigin, depth + 1, out)
  }
}

function buildCommand(
  node: BashSyntaxNode,
  origin: BashCommandOrigin,
  heredocCode: string[],
): { command: BashFlatCommand; recursions: Recursion[] } {
  const nameNode = commandNameNode(node)
  const nameText = nameNode ? nameNode.text : ''
  const dynamicName = /[$`]/.test(nameText)
  const binary = dynamicName ? '' : baseName(nameText)

  const args: string[] = []
  for (const child of node.children) {
    if (!child || NON_ARGUMENT_NODE_TYPES.has(child.type)) continue
    args.push(child.text)
  }

  const command: BashFlatCommand = {
    binary,
    args,
    dynamicName,
    origin,
    expanded: false,
    opaqueReason: null,
    text: node.text,
    maskedText: maskRanges(
      node.text,
      collectLiteralRanges(node).map((r) => ({
        start: r.start - node.startIndex,
        end: r.end - node.startIndex,
      })),
    ),
  }

  const recursions: Recursion[] = []
  const delegated = (code: string, innerOrigin: BashCommandOrigin) => {
    if (code.trim()) recursions.push({ code, origin: innerOrigin })
  }

  if (dynamicName) return { command, recursions }

  if (SHELL_BINARIES.has(binary)) {
    const scriptIndex = args.findIndex((a) => /^-[A-Za-z]*c$/.test(a))
    const script = scriptIndex >= 0 ? args[scriptIndex + 1] : undefined
    if (script !== undefined) {
      // `bash -c '<code>'` — the code is right here, and any heredoc is merely its stdin.
      delegated(stripQuotes(script), 'shell-c')
    } else {
      for (const body of heredocCode) delegated(body, 'shell-heredoc')
      if (args.some((a) => !a.startsWith('-'))) {
        // `bash deploy.sh` — the script body lives on the remote host, unreadable from here.
        command.opaqueReason = `${binary}: runs an uninspectable script file`
      } else if (args.includes('-s')) {
        command.opaqueReason = `${binary}: reads a script from stdin`
      }
    }
    return { command, recursions }
  }

  if (binary === 'eval') {
    delegated(args.map(stripQuotes).join(' '), 'eval')
    return { command, recursions }
  }

  if (SOURCE_BUILTINS.has(binary)) {
    command.opaqueReason = `${binary}: sources an external file`
    return { command, recursions }
  }

  if (PRIVILEGE_WRAPPERS.has(binary)) {
    const rest = stripWrapperPrefix(binary, args)
    if (rest.length) delegated(rest.join(' '), 'wrapper')
    return { command, recursions }
  }

  if (TRANSPARENT_WRAPPERS.has(binary)) {
    if (args.some((a) => WRAPPER_QUERY_ONLY_FLAGS.has(a))) return { command, recursions }
    const rest = stripWrapperPrefix(binary, args)
    if (rest.length) {
      delegated(rest.join(' '), 'wrapper')
    } else if (!HARMLESS_ALONE_WRAPPERS.has(binary)) {
      command.opaqueReason = `${binary}: no command to inspect`
    }
  }

  return { command, recursions }
}

function commandNameNode(node: BashSyntaxNode): BashSyntaxNode | null {
  const byField = node.childForFieldName?.('name')
  if (byField) return byField
  return node.children.find((c): c is BashSyntaxNode => !!c && c.type === 'command_name') ?? null
}

function collectLiteralRanges(node: BashSyntaxNode): Range[] {
  const ranges: Range[] = []
  const walk = (n: BashSyntaxNode) => {
    if (LITERAL_NODE_TYPES.has(n.type)) ranges.push({ start: n.startIndex, end: n.endIndex })
    for (const child of n.children) if (child) walk(child)
  }
  walk(node)
  return ranges
}

function heredocBodies(node: BashSyntaxNode): string[] {
  const bodies: string[] = []
  const walk = (n: BashSyntaxNode) => {
    if (n.type === 'heredoc_body') {
      bodies.push(n.text)
      return
    }
    for (const child of n.children) if (child) walk(child)
  }
  walk(node)
  return bodies
}

function redirectDestination(node: BashSyntaxNode): string | null {
  const byField = node.childForFieldName?.('destination')
  if (byField) return byField.text
  const candidate = node.children.find(
    (c): c is BashSyntaxNode =>
      !!c &&
      ['word', 'string', 'raw_string', 'simple_expansion', 'expansion', 'concatenation'].includes(c.type),
  )
  return candidate ? candidate.text : null
}

/**
 * `2>&1` and `1>&2` are plumbing, not writes.
 *
 * The AST splits them into a descriptor, an operator token and a bare number,
 * so the `destination` text of `2>&1` is just `1` — indistinguishable from
 * `> 1` if you only look at the destination. Every `2>&1` in the wild was
 * therefore read as "write to a file named 1" and escalated to destructive,
 * which is what put an alarming card in front of probes like `nginx -v 2>&1`.
 * The operator token is what actually separates the two cases.
 */
function isFdDuplication(node: BashSyntaxNode): boolean {
  return node.children.some((child) => !!child && FD_DUPLICATION_OPERATORS.has(child.type))
}

/** `<` feeds the command's stdin; `>`, `>>`, `&>` and `>|` write. */
function isInputRedirect(node: BashSyntaxNode): boolean {
  return node.children.some((child) => child?.type === '<')
}

function isHarmlessRedirect(rawDestination: string): boolean {
  const destination = stripQuotes(rawDestination.trim())
  if (!destination) return true
  if (HARMLESS_REDIRECT_TARGETS.has(destination)) return true
  return destination.startsWith('/dev/fd/') || destination.startsWith('/dev/tty')
}

function stripWrapperPrefix(binary: string, args: string[]): string[] {
  let index = 0
  while (index < args.length) {
    const token = args[index]
    if (token === '--') {
      index += 1
      break
    }
    if (!token.startsWith('-')) break
    index += WRAPPER_VALUE_FLAGS.has(token) ? 2 : 1
  }
  let rest = args.slice(index)
  if (binary === 'env') {
    // `env VAR=1 rm -rf /` — the assignment is not the command.
    rest = rest.filter((token) => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token))
  }
  if (binary === 'timeout' || binary === 'time') {
    // `timeout 5 rm -rf /` — drop the leading duration token.
    if (rest.length > 1 && /^\d+(\.\d+)?[smhd]?$/.test(rest[0])) rest = rest.slice(1)
  }
  return rest.filter((token) => token !== '\\' && token !== ';')
}

function baseName(raw: string): string {
  const unquoted = stripQuotes(raw.trim())
  const last = unquoted.split(/[/\\]/).pop() ?? unquoted
  return last.toLowerCase()
}

export function stripQuotes(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.length >= 2) {
    const first = trimmed[0]
    const last = trimmed[trimmed.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1)
    }
  }
  return trimmed
}

function maskRanges(source: string, ranges: Range[]): string {
  if (!ranges.length) return source
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const range of sorted) {
    if (range.end <= cursor) continue
    const start = Math.max(range.start, cursor)
    out += source.slice(cursor, start) + ' '.repeat(range.end - start)
    cursor = range.end
  }
  return out + source.slice(cursor)
}
