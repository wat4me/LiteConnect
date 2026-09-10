/**
 * Classify unified-diff lines for the approval card so `+` rows render green
 * and `-` rows red instead of one flat monospace blob. The summary line is
 * passed separately (`run.diffSummary`), so anything reaching here is raw diff
 * body — no risk of mistaking `+12 行 / -3 行` for an added line.
 */

export type DiffPreviewRowKind = 'head' | 'hunk' | 'add' | 'del' | 'ctx'

export type DiffPreviewRow = {
  text: string
  kind: DiffPreviewRowKind
}

/** `--- a/x` / `+++ b/x` are only headers before the first `@@` hunk. */
export function diffPreviewRows(diff: string | undefined): DiffPreviewRow[] {
  const text = String(diff ?? '').replace(/\r\n/g, '\n')
  if (!text) return []
  const rows: DiffPreviewRow[] = []
  let inHunk = false
  for (const line of text.split('\n')) {
    let kind: DiffPreviewRowKind
    if (!inHunk && (line.startsWith('--- ') || line.startsWith('+++ '))) {
      kind = 'head'
    } else if (line.startsWith('@@')) {
      inHunk = true
      kind = 'hunk'
    } else if (line.startsWith('+')) {
      kind = 'add'
    } else if (line.startsWith('-')) {
      kind = 'del'
    } else {
      kind = 'ctx'
    }
    rows.push({ text: line, kind })
  }
  return rows
}
