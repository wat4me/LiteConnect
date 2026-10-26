import {
  AI_TOOL_DIFF_MAX_LINES,
  buildUnifiedDiff,
  formatToolDiffSummary,
  type ToolDiffPreview,
} from '../../../shared/aiToolDiff'
import { applyExactEdit, type ExactEditFailureCode } from '../../../shared/exactEdit'
import { MCP_READ_MAX_LINES } from '../../../shared/mcp/limits'
import type { SshMcpRuntime } from '../../mcp/runtime'
import { t } from '../../i18n'

/** Approval-card payload: a one-line summary plus the raw unified diff. */
export type FileChangePreview = {
  summary: string
  diff: string
}

/** Kept as an alias so existing callers and tests keep working. */
export type WriteFileDiffPreview = FileChangePreview

const EDIT_FAILURE_LABELS: Record<ExactEditFailureCode, string> = {
  NOT_FOUND: 'toolPolicy.editNotFound',
  NOT_UNIQUE: 'toolPolicy.editNotUnique',
  NO_OP: 'toolPolicy.editNoOp',
  EMPTY_SEARCH: 'toolPolicy.editEmptySearch',
}

function readTarget(args: Record<string, unknown>): { path: string; sessionId: string } | undefined {
  const path = typeof args.path === 'string' && args.path ? args.path : ''
  const sessionId = typeof args.sessionId === 'string' && args.sessionId ? args.sessionId : ''
  if (!path || !sessionId) return undefined
  return { path, sessionId }
}

/** Read the current file as raw text (no line-number prefix) for diffing. */
async function readCurrentText(
  runtime: Pick<SshMcpRuntime, 'call'>,
  sessionId: string,
  path: string,
): Promise<{ text: string; complete: boolean } | undefined> {
  const result = await runtime.call('read_file', {
    sessionId,
    path,
    encoding: 'utf8',
    limit: Math.min(MCP_READ_MAX_LINES, AI_TOOL_DIFF_MAX_LINES),
    // The line-number prefix is a locator, not file content.
    lineNumbers: false,
  })
  const data = result?.structuredContent as { content?: unknown; eof?: unknown } | undefined
  if (!result || result.isError || typeof data?.content !== 'string') return undefined
  return { text: data.content, complete: data.eof === true }
}

function summarize(preview: ToolDiffPreview, complete: boolean): string {
  const summary = formatToolDiffSummary(preview, t)
  if (preview.truncated) return t('toolPolicy.diffTruncated', { summary })
  if (!complete) return t('toolPolicy.diffPartial', { summary })
  return summary
}

/**
 * Read the file a pending `write_file` is about to overwrite and diff it
 * against the incoming content, so the approval card shows real +/- lines
 * instead of just the tool arguments. Best effort: any failure (no SFTP, no
 * permission) is shown explicitly; base64 payloads have no text diff.
 */
export async function buildWriteFileDiffPreview(
  runtime: Pick<SshMcpRuntime, 'call'> | undefined,
  args: Record<string, unknown>,
): Promise<FileChangePreview | undefined> {
  if (!runtime) return undefined
  const target = readTarget(args)
  const next = typeof args.content === 'string' ? args.content : ''
  // A base64 payload says nothing useful as a line diff.
  if (!target || args.encoding === 'base64') return undefined

  const current = await readCurrentText(runtime, target.sessionId, target.path).catch(() => undefined)
  if (!current) {
    return { summary: t('toolPolicy.diffReadFailed'), diff: '' }
  }
  if (!current.complete) {
    return { summary: t('toolPolicy.diffReadIncomplete'), diff: '' }
  }
  const preview = buildUnifiedDiff(current.text, next, { path: target.path })
  if (!preview.diff && !preview.truncated) return undefined
  return { summary: summarize(preview, true), diff: preview.diff }

}

/**
 * Preview an `edit_file` by applying the very same exact-string edit the tool
 * will apply. That is the whole point of the tool: the diff stays small and
 * focused, so the user reviews the actual change instead of a rewritten file.
 *
 * When the read was truncated we cannot know whether the match will succeed, so
 * we never claim a failure in that case — a false "not found" on the card would
 * push the user to reject an edit that is actually fine.
 */
export async function buildEditFileDiffPreview(
  runtime: Pick<SshMcpRuntime, 'call'> | undefined,
  args: Record<string, unknown>,
): Promise<FileChangePreview | undefined> {
  if (!runtime) return undefined
  const target = readTarget(args)
  const oldString = typeof args.oldString === 'string' ? args.oldString : ''
  const newString = typeof args.newString === 'string' ? args.newString : ''
  if (!target || !oldString) return undefined

  const current = await readCurrentText(runtime, target.sessionId, target.path).catch(() => undefined)
  if (!current) return undefined

  const edit = applyExactEdit(current.text, oldString, newString, args.replaceAll === true)
  if (!edit.ok) {
    if (!current.complete) return undefined
    const label = t(EDIT_FAILURE_LABELS[edit.code])
    const summary = edit.code === 'NOT_UNIQUE' ? t('toolPolicy.editOccurrences', { label, count: edit.occurrences }) : label
    return { summary, diff: '' }
  }

  const preview = buildUnifiedDiff(current.text, edit.text, { path: target.path })
  if (!preview.diff) return { summary: t('sharedText.diffUnchanged'), diff: '' }
  return { summary: summarize(preview, current.complete), diff: preview.diff }
}

/** Dispatch a file-rewriting tool call to its preview builder. */
export async function buildFileChangeDiffPreview(
  runtime: Pick<SshMcpRuntime, 'call'> | undefined,
  toolName: string,
  args: Record<string, unknown>,
): Promise<FileChangePreview | undefined> {
  if (toolName === 'write_file') return buildWriteFileDiffPreview(runtime, args)
  if (toolName === 'edit_file') return buildEditFileDiffPreview(runtime, args)
  return undefined
}
