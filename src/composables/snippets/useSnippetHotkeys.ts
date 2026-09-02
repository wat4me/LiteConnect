import { onMounted, type ComputedRef, type Ref } from 'vue'
import type { Connection } from '@/env.d'
import type { Session } from '@/domain/session/types'
import {
  formatSnippetPayloadForWrite,
  matchSnippetHotkey,
  pendingSnippetVars,
  resolveDynamicBuiltins,
  resolveSnippetCommand,
} from '@/utils/snippets/commandSnippets'
import { getSnippetContext } from '@/utils/session/sessionDisplay'

export function useSnippetHotkeys(deps: {
  activeSessionId: ComputedRef<string | null> | Ref<string | null>
  activeSession: ComputedRef<Session | null> | Ref<Session | null>
  connections: Ref<Connection[]> | ComputedRef<Connection[]>
  openSnippetPalette: () => void
}) {
  let snippetHotkeyCache: Array<{
    id: string
    hotkey?: string
    command: string
    name: string
    sendMode?: 'run' | 'fill'
  }> | null = null
  let snippetHotkeyCacheAt = 0

  async function refreshSnippetHotkeyCache() {
    try {
      const list = await window.LiteConnect.getCommandSnippets()
      snippetHotkeyCache = list
        .filter((s) => s.hotkey)
        .map((s) => ({
          id: s.id,
          hotkey: s.hotkey,
          command: s.command,
          name: s.name,
          sendMode: s.sendMode,
        }))
      snippetHotkeyCacheAt = Date.now()
    } catch {
      snippetHotkeyCache = []
    }
  }

  function tryRunSnippetHotkey(e: KeyboardEvent): boolean {
    if (!snippetHotkeyCache || Date.now() - snippetHotkeyCacheAt > 5000) {
      void refreshSnippetHotkeyCache()
    }
    const list = snippetHotkeyCache || []
    const hit = list.find((s) => matchSnippetHotkey(e, s.hotkey))
    if (!hit) return false
    const sid = deps.activeSessionId.value
    if (!sid) return true
    void (async () => {
      const session = deps.activeSession.value
      const ctx = session ? getSnippetContext(deps.connections.value, session.connectionId) : null
      const dynamic = await resolveDynamicBuiltins()
      const merged = { ...(ctx || {}), ...dynamic }
      const pending = pendingSnippetVars(hit.command, merged)
      if (pending.length > 0) {
        deps.openSnippetPalette()
        return
      }
      const resolved = resolveSnippetCommand(hit.command, merged, dynamic)
      const mode = hit.sendMode === 'fill' ? 'fill' : 'run'
      window.LiteConnect.sshWrite(sid, formatSnippetPayloadForWrite(resolved, mode))
    })()
    return true
  }

  onMounted(() => {
    void refreshSnippetHotkeyCache()
  })

  return { tryRunSnippetHotkey, refreshSnippetHotkeyCache }
}
