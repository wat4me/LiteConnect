/**
 * Unified-diff previews for tool calls that rewrite a file.
 *
 * The AI chat asks for approval before a write, but the approval card used to
 * show only the tool arguments — the user approved blind. This builds the same
 * unified diff they would see in a code review, straight from the old remote
 * content and the incoming content, with no external diff dependency.
 */

/** Lines per side fed into the LCS; longer files still diff, just clipped. */
export const AI_TOOL_DIFF_MAX_LINES = 400
/** Hard cap on the text we put into the approval card. */
export const AI_TOOL_DIFF_MAX_CHARS = 6_000
const CONTEXT_LINES = 2
/** Above this many cell computations the LCS table is not worth it. */
const MAX_LCS_CELLS = 250_000

export type ToolDiffPreview = {
  /** Unified diff text, clipped to AI_TOOL_DIFF_MAX_CHARS. */
  diff: string
  added: number
  removed: number
  /** Target does not exist yet (or could not be read): everything is new. */
  created: boolean
  truncated: boolean
}

export function splitDiffLines(text: string): string[] {
  const normalized = String(text ?? '').replace(/\r\n/g, '\n')
  if (!normalized) return []
  const lines = normalized.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

type DiffOp =
  | { kind: 'keep'; text: string }
  | { kind: 'add'; text: string }
  | { kind: 'del'; text: string }

function lcsOps(before: string[], after: string[]): DiffOp[] {
  const ops: DiffOp[] = []
  let i = before.length
  let j = after.length
  // Common prefix/suffix trimming keeps the DP table small for typical edits.
  let head = 0
  while (head < i && head < j && before[head] === after[head]) head += 1
  let tail = 0
  while (tail < i - head && tail < j - head && before[i - tail - 1] === after[j - tail - 1]) tail += 1

  const a = before.slice(head, i - tail)
  const b = after.slice(head, j - tail)
  const middle: DiffOp[] = []
  if (a.length && b.length && a.length * b.length <= MAX_LCS_CELLS) {
    const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0))
    for (let x = a.length - 1; x >= 0; x--) {
      for (let y = b.length - 1; y >= 0; y--) {
        table[x][y] = a[x] === b[y] ? table[x + 1][y + 1] + 1 : Math.max(table[x + 1][y], table[x][y + 1])
      }
    }
    let x = 0
    let y = 0
    while (x < a.length && y < b.length) {
      if (a[x] === b[y]) {
        middle.push({ kind: 'keep', text: a[x] })
        x += 1
        y += 1
      } else if (table[x + 1][y] >= table[x][y + 1]) {
        middle.push({ kind: 'del', text: a[x] })
        x += 1
      } else {
        middle.push({ kind: 'add', text: b[y] })
        y += 1
      }
    }
    while (x < a.length) middle.push({ kind: 'del', text: a[x++] })
    while (y < b.length) middle.push({ kind: 'add', text: b[y++] })
  } else if (a.length || b.length) {
    // Too big to align: show it as a block replacement.
    for (const text of a) middle.push({ kind: 'del', text })
    for (const text of b) middle.push({ kind: 'add', text })
  }

  for (let k = 0; k < head; k++) ops.push({ kind: 'keep', text: before[k] })
  ops.push(...middle)
  for (let k = before.length - tail; k < before.length; k++) ops.push({ kind: 'keep', text: before[k] })
  return ops
}

export function buildUnifiedDiff(
  oldText: string,
  newText: string,
  opts: { path?: string; created?: boolean } = {},
): ToolDiffPreview {
  const before = splitDiffLines(oldText).slice(0, AI_TOOL_DIFF_MAX_LINES)
  const after = splitDiffLines(newText).slice(0, AI_TOOL_DIFF_MAX_LINES)
  const created = opts.created === true
  const path = opts.path || 'file'
  const clipped =
    splitDiffLines(oldText).length > AI_TOOL_DIFF_MAX_LINES ||
    splitDiffLines(newText).length > AI_TOOL_DIFF_MAX_LINES

  const ops = created ? after.map((text): DiffOp => ({ kind: 'add', text })) : lcsOps(before, after)
  let added = 0
  let removed = 0
  for (const op of ops) {
    if (op.kind === 'add') added += 1
    if (op.kind === 'del') removed += 1
  }
  if (added === 0 && removed === 0) {
    return { diff: '', added: 0, removed: 0, created, truncated: clipped }
  }

  const rows: string[] = [`--- a/${path}`, `+++ b/${path}`]
  let oldLine = 0
  let newLine = 0
  let index = 0
  let truncated = clipped
  while (index < ops.length) {
    if (ops[index].kind === 'keep') {
      oldLine += 1
      newLine += 1
      index += 1
      continue
    }
    const start = Math.max(0, index - CONTEXT_LINES)
    let end = index
    while (end < ops.length && (ops[end].kind !== 'keep' || end - index < CONTEXT_LINES * 2)) {
      if (ops[end].kind !== 'keep') index = end
      end += 1
    }
    const group = ops.slice(start, end)
    const oldStart = oldLine - (index - start) + 1
    const newStart = newLine - (index - start) + 1
    let oldCount = 0
    let newCount = 0
    for (const op of group) {
      if (op.kind !== 'add') oldCount += 1
      if (op.kind !== 'del') newCount += 1
    }
    rows.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`)
    for (const op of group) {
      if (op.kind === 'keep') rows.push(` ${op.text}`)
      else if (op.kind === 'del') rows.push(`-${op.text}`)
      else rows.push(`+${op.text}`)
    }
    // Advance the line counters for the emitted group.
    for (const op of group) {
      if (op.kind !== 'add') oldLine += 1
      if (op.kind !== 'del') newLine += 1
    }
    index = end
    if (rows.join('\n').length > AI_TOOL_DIFF_MAX_CHARS) {
      truncated = true
      break
    }
  }

  let diff = rows.join('\n')
  if (diff.length > AI_TOOL_DIFF_MAX_CHARS) {
    diff = `${diff.slice(0, AI_TOOL_DIFF_MAX_CHARS - 1)}…`
    truncated = true
  }
  return { diff, added, removed, created, truncated }
}

/** One-line summary shown above the diff: `+12 -3` style. */
export function formatToolDiffSummary(preview: ToolDiffPreview): string {
  if (preview.created) return `新文件，+${preview.added} 行`
  if (preview.added === 0 && preview.removed === 0) return '内容无变化'
  return `+${preview.added} 行 / -${preview.removed} 行`
}
