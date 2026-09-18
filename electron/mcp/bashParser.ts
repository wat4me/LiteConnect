/**
 * Wasm-backed bash parser that feeds the command classifier.
 *
 * `shared/mcp/classify.ts` stays synchronous and dependency-free; this module
 * installs the AST engine into it once at startup. Until that succeeds the
 * classifier keeps working with the weaker text splitter, so a missing or
 * broken wasm degrades the verdict quality but never blocks the tool — and
 * `classifyCommand` fails closed on anything it cannot decide either way.
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { Language, Parser } from 'web-tree-sitter'
import {
  flattenBashCommand,
  type BashParseFn,
  type BashParseResult,
  type BashSyntaxNode,
} from '../../shared/mcp/bashParse'
import { setCommandFlattener } from '../../shared/mcp/classify'

const WASM_ENV_VAR = 'LITESSH_BASH_WASM'
const WASM_FILE_NAME = 'tree-sitter-bash.wasm'

export type BashAstStatus =
  | { ok: true; grammar: string; path: string }
  | { ok: false; reason: string }

let initPromise: Promise<BashAstStatus> | null = null
let currentStatus: BashAstStatus | null = null
let parser: Parser | null = null

/** Idempotent: the first call starts the work, later calls share the promise. */
export function initBashAst(): Promise<BashAstStatus> {
  if (!initPromise) initPromise = start()
  return initPromise
}

export async function ensureBashAstReady(): Promise<boolean> {
  const result = await initBashAst()
  return result.ok
}

export function isBashAstReady(): boolean {
  return currentStatus?.ok === true
}

export function bashAstStatus(): BashAstStatus | null {
  return currentStatus
}

async function start(): Promise<BashAstStatus> {
  const path = resolveBashGrammarPath()
  if (!path) {
    return fail(`bash grammar wasm not found (looked in ${candidateGrammarPaths().join(', ')})`)
  }
  try {
    await Parser.init()
    const language = await Language.load(readFileSync(path))
    const instance = new Parser()
    instance.setLanguage(language)
    parser = instance
    setCommandFlattener(flatten)
    return succeed({ ok: true, grammar: describeGrammar(language, path), path })
  } catch (err) {
    parser = null
    setCommandFlattener(null)
    return fail(err instanceof Error ? err.message : String(err))
  }
}

function succeed(next: BashAstStatus): BashAstStatus {
  currentStatus = next
  return next
}

function fail(reason: string): BashAstStatus {
  const next: BashAstStatus = { ok: false, reason }
  currentStatus = next
  return next
}

function describeGrammar(language: Language, path: string): string {
  // `Language.version` reports the language ABI, not a package version.
  const meta = language as unknown as { name?: string; version?: string | number }
  const name = meta.name ?? 'bash'
  const abi = meta.version ?? 'unknown'
  return `${name}@abi${abi} (${path})`
}

function flatten(command: string): BashParseResult | null {
  if (!parser) return null
  const trees: Parser.Tree[] = []
  const parse: BashParseFn = (source) => {
    const tree = parser?.parse(source)
    if (!tree) return null
    trees.push(tree)
    return tree.rootNode as unknown as BashSyntaxNode
  }
  const activeParser = parser
  try {
    return flattenBashCommand(parse, command)
  } finally {
    for (const tree of trees) {
      try {
        tree.delete()
      } catch {
        /* the tree is already gone; nothing to release */
      }
    }
    activeParser.reset()
  }
}

export function resolveBashGrammarPath(): string | null {
  for (const candidate of candidateGrammarPaths()) {
    try {
      if (candidate && existsSync(candidate)) return candidate
    } catch {
      /* unreadable candidate; try the next one */
    }
  }
  return null
}

function candidateGrammarPaths(): string[] {
  const candidates: string[] = []
  const fromEnv = process.env[WASM_ENV_VAR]
  if (fromEnv) candidates.push(fromEnv)

  // Packaged and `vite build` output: the wasm is copied next to main.js.
  candidates.push(join(moduleDir(), WASM_FILE_NAME))
  candidates.push(join(moduleDir(), 'vendor', WASM_FILE_NAME))
  // Dev server and vitest both run from the repository root.
  candidates.push(join(process.cwd(), 'shared', 'mcp', 'vendor', WASM_FILE_NAME))

  const resourcesPath = (process as unknown as { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    candidates.push(join(resourcesPath, WASM_FILE_NAME))
    candidates.push(join(resourcesPath, 'app.asar', 'shared', 'mcp', 'vendor', WASM_FILE_NAME))
    candidates.push(join(resourcesPath, 'app', 'shared', 'mcp', 'vendor', WASM_FILE_NAME))
  }
  return candidates
}

function moduleDir(): string {
  // CJS (the packaged main process) has __dirname; ESM (vitest) does not.
  return typeof __dirname === 'string' && __dirname ? __dirname : process.cwd()
}
