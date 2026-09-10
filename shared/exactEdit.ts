/**
 * Exact-string edit semantics, shared by the `edit_file` tool and the approval
 * card's diff preview so both agree on what an edit will do.
 *
 * Deliberately regex-free. `String.prototype.replace` is not used for the
 * replacement because it interprets `$&`, `$1`, `` $` `` … even when the pattern
 * is a plain string — a config file containing a literal `$` would be silently
 * rewritten. Everything here is indexOf/slice.
 */

export type ExactEditFailureCode = 'EMPTY_SEARCH' | 'NO_OP' | 'NOT_FOUND' | 'NOT_UNIQUE'

export type ExactEditResult =
  | { ok: true; text: string; replaced: number }
  | { ok: false; code: ExactEditFailureCode; occurrences: number; message: string; hint: string }

/** Literal, non-overlapping occurrence count. */
export function countOccurrences(content: string, search: string): number {
  if (!search) return 0
  let count = 0
  let from = 0
  for (;;) {
    const at = content.indexOf(search, from)
    if (at < 0) return count
    count += 1
    from = at + search.length
  }
}

/**
 * The most common near-miss on a not-found edit: the file uses CRLF but the
 * search was built with bare LF. Say so explicitly rather than leaving the
 * agent to guess why an apparently identical block did not match.
 */
function crlfHint(content: string, oldString: string): string {
  if (!content.includes('\r\n')) return ''
  if (oldString.includes('\r\n') || !oldString.includes('\n')) return ''
  return ' This file uses CRLF line endings — include the \\r in multi-line oldString.'
}

/**
 * Replace `oldString` with `newString`.
 *
 * `replaceAll: false` (default) requires exactly one occurrence, so an
 * ambiguous search fails loudly instead of editing the wrong block.
 */
export function applyExactEdit(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): ExactEditResult {
  if (!oldString) {
    return {
      ok: false,
      code: 'EMPTY_SEARCH',
      occurrences: 0,
      message: 'oldString is required and must not be empty.',
      hint: 'Pass the exact existing text to replace.',
    }
  }
  if (oldString === newString) {
    return {
      ok: false,
      code: 'NO_OP',
      occurrences: 0,
      message: 'oldString and newString are identical, so nothing would change.',
      hint: 'Call read_file first, then pass the text you actually want written.',
    }
  }

  const occurrences = countOccurrences(content, oldString)
  if (occurrences === 0) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      occurrences: 0,
      message: 'oldString was not found in the current file content.',
      hint:
        'Call read_file on this path and copy oldString verbatim from what it returns — ' +
        'indentation, quoting and line endings must match exactly. Do not include the read_file line-number prefix.' +
        crlfHint(content, oldString),
    }
  }
  if (occurrences > 1 && !replaceAll) {
    return {
      ok: false,
      code: 'NOT_UNIQUE',
      occurrences,
      message: `oldString occurs ${occurrences} times, so the target is ambiguous.`,
      hint:
        'Add surrounding lines to oldString so it matches once, or set replaceAll=true ' +
        `to change all ${occurrences} occurrences.`,
    }
  }

  if (replaceAll) {
    let text = ''
    let from = 0
    let replaced = 0
    for (;;) {
      const at = content.indexOf(oldString, from)
      if (at < 0) break
      text += content.slice(from, at) + newString
      from = at + oldString.length
      replaced += 1
    }
    return { ok: true, text: text + content.slice(from), replaced }
  }

  const at = content.indexOf(oldString)
  const text = content.slice(0, at) + newString + content.slice(at + oldString.length)
  return { ok: true, text, replaced: 1 }
}
