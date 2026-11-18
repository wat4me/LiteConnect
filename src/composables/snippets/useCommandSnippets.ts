import { ref } from 'vue'
import { t } from '../../i18n'
import type { CommandSnippet } from '@/env.d'
import { appPrompt } from '@/composables/app/useAppDialog'
import { emitAppEvent } from '@/utils/shared/appEvents'
import {
  pendingSnippetVars,
  resolveDynamicBuiltins,
  resolveSnippetCommand,
  type SnippetContext,
} from '@/utils/snippets/commandSnippets'

export interface SnippetSessionInfo {
  id: string
  label: string
  host?: string
  user?: string
  port?: number
  name?: string
}

/**
 * Snippet list persistence and variable resolution shared by the snippets panel
 * and the quick palette. Each caller keeps its own list instance and presentation.
 */
export function useCommandSnippets(options: {
  sessions: () => SnippetSessionInfo[] | undefined
  snippetContext: () => SnippetContext | null | undefined
}) {
  const snippets = ref<CommandSnippet[]>([])
  const loading = ref(false)

  async function loadSnippets() {
    loading.value = true
    try {
      snippets.value = await window.LiteConnect.getCommandSnippets()
    } finally {
      loading.value = false
    }
  }

  /** Persists the list and adopts the normalized result returned by the store. */
  async function saveSnippets(next: CommandSnippet[]) {
    snippets.value = await window.LiteConnect.setCommandSnippets(next)
    emitAppEvent('command-snippets-change')
  }

  /** Usage statistics are best-effort and never fail the send that triggered them. */
  async function recordUse(item: CommandSnippet) {
    const next = snippets.value.map((s) =>
      s.id === item.id ? { ...s, useCount: (s.useCount || 0) + 1, lastUsedAt: Date.now() } : s,
    )
    try {
      await saveSnippets(next)
    } catch {
      // non-fatal
    }
  }

  function contextForSession(sessionId: string | null): SnippetContext | null {
    const fallback = options.snippetContext() || null
    if (!sessionId) return fallback
    const s = options.sessions()?.find((x) => x.id === sessionId)
    if (s && (s.host || s.user)) return { host: s.host, user: s.user, port: s.port, name: s.name }
    return fallback
  }

  /** Asks for each custom variable and stores the answers in `values`; false when the user cancels. */
  async function promptSnippetVars(
    names: string[],
    values: Record<string, string>,
    messageKey = 'snippets.fillVarMessage',
  ): Promise<boolean> {
    for (const name of names) {
      try {
        values[name] = await appPrompt({
          title: t('snippets.fillVarTitle'),
          message: t(messageKey, { var: name }),
          inputPlaceholder: name,
          required: false,
        })
      } catch {
        return false
      }
    }
    return true
  }

  /** Built-ins come from the context and dynamic values; custom variables are prompted. Null when cancelled. */
  async function resolveForContext(command: string, ctx: SnippetContext | null): Promise<string | null> {
    const dynamic = await resolveDynamicBuiltins()
    const mergedCtx: SnippetContext = { ...(ctx || {}), ...dynamic }
    const extra: Record<string, string> = { ...dynamic }
    if (!await promptSnippetVars(pendingSnippetVars(command, mergedCtx), extra)) return null
    return resolveSnippetCommand(command, mergedCtx, extra)
  }

  return {
    snippets,
    loading,
    loadSnippets,
    saveSnippets,
    recordUse,
    contextForSession,
    promptSnippetVars,
    resolveForContext,
  }
}
