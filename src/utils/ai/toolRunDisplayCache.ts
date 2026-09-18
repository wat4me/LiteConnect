import { formatToolRunArgs, formatToolRunDisplay, type ToolRunDisplay } from '@shared/aiToolRunDisplay'

export const TOOL_DISPLAY_MAX_CHARS = 20_000
export const TOOL_ARGS_MAX_CHARS = 4_000

function preview(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}\n…` : text
}

type ToolRunInput = {
  name: string
  args?: string
  content?: string
  isError?: boolean
}

/** Per-view cache; weak keys let removed messages and their tool output be collected. */
export function createToolRunDisplayCache() {
  const displays = new WeakMap<ToolRunInput, ToolRunInput & { view: ToolRunDisplay }>()
  const argumentsText = new WeakMap<ToolRunInput, { args?: string; text: string }>()

  function toolView(run: ToolRunInput): ToolRunDisplay {
    // Read the reactive fields even on cache hits so in-place updates stay tracked.
    const { name, args, content, isError } = run
    const cached = displays.get(run)
    if (cached && cached.name === name && cached.args === args &&
      cached.content === content && cached.isError === isError) return cached.view
    // Oversized historical/unexpected payloads must not be parsed in the renderer.
    const view: ToolRunDisplay = (content?.length || 0) > TOOL_DISPLAY_MAX_CHARS ||
      (args?.length || 0) > TOOL_ARGS_MAX_CHARS
      ? { summary: { kind: 'ok' }, hint: '', body: preview(content || '', TOOL_DISPLAY_MAX_CHARS) }
      : formatToolRunDisplay({ name, args, content, isError })
    view.body = preview(view.body, TOOL_DISPLAY_MAX_CHARS)
    view.hint = preview(view.hint, 300)
    if (view.summary.kind === 'text') view.summary.text = preview(view.summary.text, 300)
    displays.set(run, { name, args, content, isError, view })
    return view
  }

  function toolArgsText(run: ToolRunInput): string {
    const args = run.args
    const cached = argumentsText.get(run)
    if (cached && cached.args === args) return cached.text
    const text = (args?.length || 0) > TOOL_ARGS_MAX_CHARS
      ? preview(args || '', TOOL_ARGS_MAX_CHARS)
      : preview(formatToolRunArgs(args), TOOL_ARGS_MAX_CHARS)
    argumentsText.set(run, { args, text })
    return text
  }

  return { toolView, toolArgsText }
}
