import { t } from '../i18n'
/**
 * Command snippet variable resolution.
 *
 * Built-in vars (auto-filled from connection / runtime context):
 *   {host} {user} {port} {name}
 *   {date} {time} {clipboard}
 * Also accepts double-brace form: {{host}} {{user}} …
 *
 * Other {{custom}} or {custom} placeholders prompt the user (caller supplies values).
 */

export type SnippetContext = {
  host?: string
  user?: string
  port?: number | string
  name?: string
  /** Extra built-in / pre-filled values */
  [key: string]: string | number | undefined
}

const BUILTIN_KEYS = new Set([
  'host',
  'user',
  'port',
  'name',
  'username',
  'hostname',
  'date',
  'time',
  'clipboard',
])

/** Match `{name}` or `{{name}}` (not nested). */
const VAR_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}|\{([a-zA-Z0-9_.-]+)\}/g

export type SnippetExportFields = {
  name: string
  command: string
  group?: string
  pinned?: boolean
  sendMode?: 'run' | 'fill'
  hotkey?: string
}

export function extractSnippetVars(command: string): string[] {
  if (!command) return []
  const names = new Set<string>()
  const re = new RegExp(VAR_RE.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(command))) {
    names.add(m[1] || m[2])
  }
  return Array.from(names)
}

function normalizeKey(key: string): string {
  if (key === 'username') return 'user'
  if (key === 'hostname') return 'host'
  return key
}

export function buildBuiltinMap(ctx: SnippetContext | null | undefined): Record<string, string> {
  if (!ctx) return {}
  const map: Record<string, string> = {}
  if (ctx.host != null && String(ctx.host)) map.host = String(ctx.host)
  if (ctx.hostname != null && String(ctx.hostname)) map.host = String(ctx.hostname)
  if (ctx.user != null && String(ctx.user)) map.user = String(ctx.user)
  if (ctx.username != null && String(ctx.username)) map.user = String(ctx.username)
  if (ctx.port != null && String(ctx.port) !== '') map.port = String(ctx.port)
  if (ctx.name != null && String(ctx.name)) map.name = String(ctx.name)
  for (const [k, v] of Object.entries(ctx)) {
    if (v == null || v === '') continue
    const nk = normalizeKey(k)
    if (!(nk in map)) map[nk] = String(v)
  }
  return map
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Runtime built-ins: date / time / clipboard (async for clipboard). */
export async function resolveDynamicBuiltins(
  clipboardRead?: () => Promise<string>,
): Promise<Record<string, string>> {
  const now = new Date()
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const time = `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
  let clipboard = ''
  if (clipboardRead) {
    try {
      clipboard = (await clipboardRead()) || ''
    } catch {
      clipboard = ''
    }
  } else if (typeof window !== 'undefined' && window.LiteConnect?.clipboardReadText) {
    try {
      clipboard = (await window.LiteConnect.clipboardReadText()) || ''
    } catch {
      clipboard = ''
    }
  }
  return { date, time, clipboard }
}

/**
 * Replace all placeholders. `extra` overrides / supplies custom vars.
 * Unknown vars left as-is if leaveUnknown; otherwise replaced with empty string when force.
 */
export function resolveSnippetCommand(
  command: string,
  ctx?: SnippetContext | null,
  extra?: Record<string, string>,
  options?: { leaveUnknown?: boolean },
): string {
  if (!command) return command
  const builtins = buildBuiltinMap(ctx)
  const values: Record<string, string> = { ...builtins, ...(extra || {}) }
  const leaveUnknown = options?.leaveUnknown !== false

  return command.replace(VAR_RE, (full, a: string, b: string) => {
    const key = normalizeKey(a || b)
    if (key in values) return values[key]
    const raw = a || b
    if (raw in values) return values[raw]
    return leaveUnknown ? full : ''
  })
}

/** Vars that still need user input after applying context. */
export function pendingSnippetVars(
  command: string,
  ctx?: SnippetContext | null,
  extra?: Record<string, string>,
): string[] {
  const builtins = buildBuiltinMap(ctx)
  const values = { ...builtins, ...(extra || {}) }
  return extractSnippetVars(command).filter((name) => {
    const key = normalizeKey(name)
    if (key in values || name in values) return false
    // Dynamic builtins are filled at run time
    if (key === 'date' || key === 'time' || key === 'clipboard') return false
    return true
  })
}

export function isBuiltinSnippetVar(name: string): boolean {
  return BUILTIN_KEYS.has(normalizeKey(name))
}

export type SnippetExportPayload = {
  version: 1
  kind: 'LiteConnect-command-snippets'
  exportedAt: string
  snippets: SnippetExportFields[]
}

export function buildSnippetExport(snippets: SnippetExportFields[]): SnippetExportPayload {
  return {
    version: 1,
    kind: 'LiteConnect-command-snippets',
    exportedAt: new Date().toISOString(),
    snippets: snippets.map((s) => ({
      name: s.name,
      command: s.command,
      group: s.group,
      pinned: s.pinned === true ? true : undefined,
      sendMode: s.sendMode === 'fill' ? 'fill' : undefined,
      hotkey: s.hotkey || undefined,
    })),
  }
}

export function parseSnippetImport(raw: unknown): SnippetExportFields[] {
  if (!raw || typeof raw !== 'object') throw new Error(t('snippets.invalidImport'))
  const obj = raw as Record<string, unknown>
  let list: unknown[]
  if (Array.isArray(obj.snippets)) {
    list = obj.snippets
  } else if (Array.isArray(raw)) {
    list = raw as unknown[]
  } else {
    throw new Error(t('snippets.importMissingList'))
  }
  const out: SnippetExportFields[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    if (typeof s.command !== 'string' || !s.command.trim()) continue
    out.push({
      name: typeof s.name === 'string' && s.name.trim() ? s.name.trim() : t('snippets.unnamed'),
      command: s.command,
      group: typeof s.group === 'string' && s.group.trim() ? s.group.trim() : undefined,
      pinned: s.pinned === true,
      sendMode: s.sendMode === 'fill' ? 'fill' : 'run',
      hotkey: typeof s.hotkey === 'string' && s.hotkey.trim() ? s.hotkey.trim() : undefined,
    })
  }
  if (out.length === 0) throw new Error(t('snippets.importEmpty'))
  return out
}

/** Merge imported snippets into existing (append; generate new ids by caller). */
export function mergeImportedSnippets(
  existing: Array<{ name: string; command: string; group?: string }>,
  imported: Array<{ name: string; command: string; group?: string }>,
  mode: 'append' | 'replace',
): Array<{ name: string; command: string; group?: string }> {
  if (mode === 'replace') {
    return imported.map((s) => ({ name: s.name, command: s.command, group: s.group }))
  }
  return [
    ...existing.map((s) => ({ name: s.name, command: s.command, group: s.group })),
    ...imported.map((s) => ({ name: s.name, command: s.command, group: s.group })),
  ]
}

export function compareSnippets(
  a: {
    pinned?: boolean
    sortOrder?: number
    group?: string
    name: string
    lastUsedAt?: number
  },
  b: {
    pinned?: boolean
    sortOrder?: number
    group?: string
    name: string
    lastUsedAt?: number
  },
): number {
  const pa = a.pinned === true
  const pb = b.pinned === true
  if (pa !== pb) return pa ? -1 : 1
  const so = (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  if (so !== 0) return so
  const ga = a.group || ''
  const gb = b.group || ''
  if (ga !== gb) return ga.localeCompare(gb, undefined, { sensitivity: 'base' })
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
}

/** Match a keyboard event against a stored hotkey string like "Ctrl+Alt+1". */
export function matchSnippetHotkey(e: KeyboardEvent, hotkey: string | undefined): boolean {
  if (!hotkey || !hotkey.trim()) return false
  const parts = hotkey
    .split('+')
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean)
  if (parts.length === 0) return false

  let wantCtrl = false
  let wantAlt = false
  let wantShift = false
  let wantMeta = false
  let keyPart = ''
  for (const p of parts) {
    if (p === 'ctrl' || p === 'control' || p === 'cmdorctrl') wantCtrl = true
    else if (p === 'alt' || p === 'option') wantAlt = true
    else if (p === 'shift') wantShift = true
    else if (p === 'meta' || p === 'cmd' || p === 'command' || p === 'win' || p === 'super') wantMeta = true
    else keyPart = p
  }
  if (!keyPart) return false

  const mod = e.ctrlKey || e.metaKey
  if (wantCtrl && !mod) return false
  if (!wantCtrl && e.ctrlKey) return false
  // On mac, meta is common; if hotkey says Ctrl we already accepted meta via mod.
  // If hotkey explicitly wants Meta only:
  if (wantMeta && !e.metaKey && !e.ctrlKey) return false
  if (wantAlt !== e.altKey) return false
  if (wantShift !== e.shiftKey) return false

  const ek = e.key.toLowerCase()
  if (keyPart === 'space') return ek === ' ' || ek === 'spacebar' || ek === 'space'
  if (keyPart.length === 1) return ek === keyPart
  return ek === keyPart
}

export function formatSnippetPayloadForWrite(command: string, sendMode: 'run' | 'fill' | undefined): string {
  if (sendMode === 'fill') return command
  return command.endsWith('\n') ? command : `${command}\n`
}
