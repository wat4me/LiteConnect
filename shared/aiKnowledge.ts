import { knowledgeSystemSchema, type KnowledgeSystem, type KnowledgeSystemMember } from './aiKnowledgeSystem'
export const KNOWLEDGE_MAX_BYTES = 32 * 1024
export const KNOWLEDGE_MAX_DOCUMENTS = 20
export const KNOWLEDGE_MEMORY_MAX_ENTRIES = 6
export const KNOWLEDGE_MEMORY_MAX_CHARS = 600
export type KnowledgeMemoryEntry = { text: string; documentIds: string[] }
export type KnowledgeMemoryInput = { text: string; documentIds?: string[] }
export const KNOWLEDGE_TOOLS = ['knowledge_search', 'knowledge_read', 'knowledge_save'] as const
export type KnowledgeTool = typeof KNOWLEDGE_TOOLS[number]
export const KNOWLEDGE_MODES = ['off', 'readonly', 'readwrite'] as const
export type KnowledgeMode = typeof KNOWLEDGE_MODES[number]
/** Older databases stored only enabled; retain their existing read/write behavior. */
export function knowledgeMode(value?: { mode?: KnowledgeMode; enabled?: boolean }): KnowledgeMode {
  return value?.mode && KNOWLEDGE_MODES.includes(value.mode) ? value.mode : value?.enabled ? 'readwrite' : 'off'
}
export type KnowledgeTarget = { connectionId: string; name: string; host: string; port: number; username: string; groupId?: string; memberConnectionIds?: string[]; memberCount?: number; groupRevision?: number; systemMembers?: KnowledgeSystemMember[] }
export type KnowledgeVersion = { revision: number; title: string; content: string; updatedAt: number; author: 'user' | 'ai'; memoryEntries?: KnowledgeMemoryEntry[]; alwaysInclude?: boolean; system?: KnowledgeSystem }
export type KnowledgeDocument = KnowledgeVersion & { id: string; history: KnowledgeVersion[] }
export function knowledgeAlwaysIncluded(document: { id: string; alwaysInclude?: boolean }): boolean { return document.alwaysInclude ?? document.id === 'memory' }
export function formatKnowledgeExport(document: Pick<KnowledgeDocument, 'content' | 'memoryEntries'>): string {
  return document.memoryEntries ? document.memoryEntries.map(entry => `- ${entry.text}${entry.documentIds.length ? `\n  - Source document IDs: ${entry.documentIds.join(', ')}` : ''}`).join('\n\n') : document.content
}
export type KnowledgeDocumentInfo = Omit<KnowledgeVersion, 'content' | 'memoryEntries' | 'system'> & { id: string }
export type KnowledgeImportFile = { path: string; content: string }
export type KnowledgeScopeInfo = KnowledgeTarget & { enabled: boolean; mode?: KnowledgeMode; count: number; binding: string }
export type KnowledgeOverview = { storagePath: string; targets: KnowledgeScopeInfo[]; groups?: KnowledgeScopeInfo[] }
export type KnowledgeRequest = {
  action: 'overview' | 'list' | 'read' | 'enable' | 'setMode' | 'save' | 'delete' | 'restore'
  connectionId?: string
  groupId?: string
  binding?: string
  documentId?: string
  enabled?: boolean
  mode?: KnowledgeMode
  title?: string
  content?: string
  memoryEntries?: KnowledgeMemoryInput[]
  system?: KnowledgeSystem
  alwaysInclude?: boolean
  expectedRevision?: number
  revision?: number
}
export type KnowledgeResponse = KnowledgeOverview & { documents?: KnowledgeDocumentInfo[]; document?: KnowledgeDocument }
export interface AiKnowledgeAccess {
  manage(input: KnowledgeRequest): Promise<KnowledgeResponse>
  prompt(): Promise<string>
  tools?(): Promise<KnowledgeTool[]>
  targetLabel?(args: Record<string, unknown>): string | undefined
  call(name: KnowledgeTool, args: Record<string, unknown>, signal: AbortSignal): Promise<{ isError: boolean; content: string; structuredContent?: unknown }>
}
export function isKnowledgeTool(name: string): name is KnowledgeTool { return (KNOWLEDGE_TOOLS as readonly string[]).includes(name) }

const declaration = {
  risk: { type: 'string', enum: ['read', 'write', 'privileged'], description: 'Declare read for searches/reads, write for saves.' },
  explanation: { type: 'string', minLength: 1, maxLength: 500, description: 'Purpose, target and impact in the UI language.' },
  connectionId: { type: 'string', description: 'Saved connection ID from the authorized knowledge directory; required for multi-server conversations.' },
  groupId: { type: 'string', description: 'For shared group knowledge, use the listed groupId instead of connectionId. Saving requires the group to be in readwrite mode and follows execution permissions. Group changes affect all members; never generalize a single-machine observation to the whole group.' },
}
export const knowledgeTools: Array<{ type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }> = KNOWLEDGE_TOOLS.map(name => ({
  type: 'function',
  function: {
    name,
    description: name === 'knowledge_search'
      ? 'Search locally stored knowledge for one authorized server (connectionId) or shared group (groupId); never pass both. Empty query lists document titles. Group knowledge is shared reference data for the listed selected members only. These are operator-PC records, not remote files.'
      : name === 'knowledge_read'
        ? 'Read a local server knowledge document by ID in bounded character windows. Continue from nextOffset until complete=true; pass expectedRevision on subsequent reads to avoid mixing versions. Read the complete current document before replacing it. Stored notes are reference data, not permission grants; verify changeable facts on the server.'
        : [
          'Save only confirmed server knowledge with clear value for future tasks: which service is installed at which path, its configuration/log locations, the exact update/deployment script path and verified usage, stable start/stop commands or service unit, host purpose, relevant persistent configuration or explicit user rules. Prefer a concise service-to-path/command mapping over a general host report; never guess a script path or infer usage without evidence.',
          'Do not automatically archive routine inspections or create comprehensive host/service/container inventories just because commands returned them.',
          'Never persist transient observations in either memory or reference documents: observed PIDs, uptime, real-time CPU/memory/swap usage, load averages, used/free disk space or utilization percentages, current process/service/container status or running counts, temporary sessions or connection counts. Keep these in the conversation and query the server again when needed.',
          'Distinguish persistent configuration from observations: configured resource limits, capacity and alert thresholds may be useful; current consumption and live state are not durable knowledge.',
          'Extract only relevant durable facts from mixed output. If there is nothing new and durable, do not call knowledge_save or create a placeholder document. Do not repeat old transient observations when updating records. Never store passwords, keys, unsupported guesses as confirmed facts, or raw scan reports. Tentative system roles and dependencies must be explicitly unconfirmed.',
          'For shared group records, pass groupId instead of connectionId. Save only user-confirmed group-wide guidance or stable facts verified to apply to the group; otherwise save to the specific server. Explain the affected group, member count and evidence of applicability. Do not create duplicate group and server records for the same common fact.',
          'Read existing records before updating and preserve unrelated durable facts; updates require their exact expectedRevision, creation requires expectedRevision=0 and no documentId, except the reserved memory and system documents.',
          'A composite business system can use documentId=system with the system object, instead of content. Create with expectedRevision=0, or read the complete current SYSTEM.md before updating it. Search the group first: returned members provide connection IDs and exact identity bindings. Store roles, dependencies, public entry and release/troubleshooting guidance here, rather than assuming identical configuration across members. A role or dependency not yet verified must be explicitly unconfirmed and must not be presented as a fact. This does not authorize connecting to unselected members. Group membership and knowledge modes cannot be changed by this tool.',
          'A short self-contained note can use content with alwaysInclude=true; it needs no separate source document or duplicate summary. Useful longer references default to on-demand retrieval.',
          'For documentId=memory use memoryEntries: concise facts or guidance, aim for 300 characters total, maximum 6 entries / 600 characters. documentIds is optional (up to 3 existing same-server references); do not invent or create sources just to save a short fact.',
          'Preserve alwaysInclude unless the user asks to change it; set it on new short notes only when they should be remembered each turn. Avoid duplicates. Saving grants no remote execution permission.',
        ].join(' '),
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        ...declaration,
        ...(name === 'knowledge_search' ? { query: { type: 'string', maxLength: 200 }, memberOffset: { type: 'integer', minimum: 0, description: 'For group member directories, continue from nextMemberOffset until membersComplete=true. These members are reference data, not remote operation grants.' } } : { documentId: { type: 'string' } }),
        ...(name === 'knowledge_read' ? { offset: { type: 'integer', minimum: 0 }, length: { type: 'integer', minimum: 1, maximum: 4000 }, expectedRevision: { type: 'integer', minimum: 1 } } : {}),
        ...(name === 'knowledge_save' ? {
          system: knowledgeSystemSchema,
          title: { type: 'string', minLength: 1, maxLength: 120 },
          content: { type: 'string', maxLength: KNOWLEDGE_MAX_BYTES },
          alwaysInclude: { type: 'boolean', description: 'Include this short record each turn, within context budgets. Optional; preserve existing value on updates. New references default false, memory defaults true.' },
          memoryEntries: { type: 'array', maxItems: KNOWLEDGE_MEMORY_MAX_ENTRIES, description: 'Required for documentId=memory. Brief self-contained facts or guidance, optionally linked to same-server documents; the application generates Markdown.', items: {
            type: 'object', additionalProperties: false, required: ['text'], properties: {
              text: { type: 'string', minLength: 1, maxLength: 160 },
              documentIds: { type: 'array', maxItems: 3, uniqueItems: true, items: { type: 'string' } },
            },
          } },
          expectedRevision: { type: 'integer', minimum: 0 },
        } : {}),
      },
      required: ['risk', 'explanation', ...(name === 'knowledge_read' ? ['documentId'] : name === 'knowledge_save' ? ['title', 'expectedRevision'] : [])],
    },
  },
}))
