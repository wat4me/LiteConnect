import type { AiHistoryRecord } from './types/ai'

export const AI_LOAD_TOOLS = 'load_tools'
export const AI_TOOL_GROUPS = {
  file_transfer: ['upload_file', 'download_file'],
  interactive_terminal: ['pty_open', 'pty_write', 'pty_read', 'pty_resize', 'pty_close', 'pty_list'],
  job_overview: ['list_jobs'],
} as const
export type AiToolGroup = keyof typeof AI_TOOL_GROUPS
export const AI_TOOL_GROUP_LABELS: Record<AiToolGroup, string> = {
  file_transfer: '文件传输', interactive_terminal: '交互式终端', job_overview: '后台任务总览',
}

const CORE_SERVER_TOOLS = ['exec', 'read_file', 'write_file', 'edit_file', 'grep', 'get_job', 'cancel_job']
export const AI_CHAT_SERVER_TOOLS: ReadonlySet<string> = new Set([...CORE_SERVER_TOOLS, ...Object.values(AI_TOOL_GROUPS).flat()])

/** Fixed order keeps tool payloads stable regardless of the order of loading. */
export function normalizeAiToolGroups(value: unknown): AiToolGroup[] {
  return Object.keys(AI_TOOL_GROUPS).filter(group => Array.isArray(value) && value.includes(group)) as AiToolGroup[]
}

export function parseAiToolGroupRequest(value: unknown): AiToolGroup[] | undefined {
  if (!Array.isArray(value) || !value.length || value.length > 3 || value.some(group => typeof group !== 'string' || !Object.prototype.hasOwnProperty.call(AI_TOOL_GROUPS, group))) return undefined
  return normalizeAiToolGroups(value)
}

export function aiChatServerToolNames(groups: readonly AiToolGroup[] = []): Set<string> {
  return new Set([...CORE_SERVER_TOOLS, ...normalizeAiToolGroups(groups).flatMap(group => AI_TOOL_GROUPS[group])])
}

/** Successful local loads and legacy optional-tool use survive context compaction. */
export function aiToolGroupsFromHistory(records: readonly Pick<AiHistoryRecord, 'toolRuns'>[]): AiToolGroup[] {
  const groups: AiToolGroup[] = []
  for (const record of records) for (const run of record.toolRuns || []) {
    if (run.isError || run.status !== 'done') continue
    if (run.name === AI_LOAD_TOOLS) {
      try { groups.push(...(parseAiToolGroupRequest(JSON.parse(run.args).groups) || [])) } catch { /* Invalid history is not a capability request. */ }
    } else {
      for (const group of normalizeAiToolGroups(Object.keys(AI_TOOL_GROUPS))) {
        if ((AI_TOOL_GROUPS[group] as readonly string[]).includes(run.name)) groups.push(group)
      }
    }
  }
  return normalizeAiToolGroups(groups)
}

export const aiLoadToolsDefinition = {
  type: 'function' as const,
  function: {
    name: AI_LOAD_TOOLS,
    description: 'Load optional tools for this conversation: file_transfer (upload_file/download_file between operator PC and server); interactive_terminal (dedicated PTY open/write/read/resize/close/list for interactive programs); job_overview (list_jobs to recover job ids or inspect an overview). Definitions become available in the next model request and remain loaded in this conversation. Loading performs no remote operation and grants no execution approval. Call this tool alone, then use the loaded tools.',
    parameters: {
      type: 'object',
      properties: { groups: { type: 'array', items: { type: 'string', enum: Object.keys(AI_TOOL_GROUPS) }, minItems: 1, maxItems: 3, uniqueItems: true } },
      required: ['groups'],
      additionalProperties: false,
    },
  },
}
