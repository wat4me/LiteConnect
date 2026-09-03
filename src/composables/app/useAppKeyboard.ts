import type { ComputedRef, Ref } from 'vue'
import type { ConnectionGroup } from '@/domain/session/types'
import { isBrowserPageZoomKey } from '@/utils/terminal/terminalFontZoom'

export function useAppKeyboard(deps: {
  isHomeActive: ComputedRef<boolean>
  /** False when database module (or other non-SSH shell) is active */
  isSshWorkspace?: ComputedRef<boolean>
  activeGroup: ComputedRef<ConnectionGroup | null>
  toggleSidebar: () => void
  toggleAiSidebar: () => void
  toggleMonitor: () => void
  toggleBatchPanel: () => void
  toggleSnippetsPanel?: () => void
  toggleDocker?: () => void
  openSnippetPalette?: () => void
  openJumpPalette?: () => void
  openShortcutsHelp?: () => void
  onSnippetHotkey?: (e: KeyboardEvent) => boolean
  onCloseGroup: (connectionId: string) => void
  onAddSession?: (connectionId: string) => void
  onSelectSession?: (sessionId: string) => void
  hostKeyMismatchVisible?: Ref<boolean>
  decryptionFailedVisible?: Ref<boolean>
  onHostKeyReject?: () => void
  onDecryptionDismiss?: () => void
}) {
  function isTypingTarget(target: EventTarget | null): boolean {
    if (!target || typeof HTMLElement === 'undefined') return false
    if (!(target instanceof HTMLElement)) return false
    const tag = target.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
    if (target.isContentEditable) return true
    return false
  }

  /** Terminal-workspace shortcuts only apply on the SSH module with an open session */
  function isTerminalContext(): boolean {
    if (deps.isHomeActive.value) return false
    if (deps.isSshWorkspace && !deps.isSshWorkspace.value) return false
    return true
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (deps.hostKeyMismatchVisible?.value) {
        e.preventDefault()
        deps.onHostKeyReject?.()
        return
      }
      if (deps.decryptionFailedVisible?.value) {
        e.preventDefault()
        deps.onDecryptionDismiss?.()
        return
      }
    }

    // Snippet custom hotkeys (may include Alt without Ctrl)
    if (isTerminalContext() && !isTypingTarget(e.target) && deps.onSnippetHotkey?.(e)) {
      e.preventDefault()
      return
    }

    // ? — shortcuts help (when not typing)
    if (!isTypingTarget(e.target) && (e.key === '?' || (e.key === '/' && e.shiftKey)) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault()
      deps.openShortcutsHelp?.()
      return
    }

    const mod = e.ctrlKey || e.metaKey
    if (!mod) return

    // Chromium page zoom (Ctrl+= / Ctrl++ / Ctrl+- / Ctrl+0) scales the whole
    // SSH chrome. Terminal font zoom is handled on the xterm textarea; this
    // only cancels the browser default (also when focus is not in the terminal).
    if (isBrowserPageZoomKey(e)) {
      e.preventDefault()
      return
    }

    const key = e.key.toLowerCase()

    // Ctrl+/ — 快捷键一览（输入框内也可用，方便随时查阅）
    if ((key === '/' || e.code === 'Slash') && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      deps.openShortcutsHelp?.()
      return
    }

    // Avoid hijacking other shortcuts while typing in form fields
    if (isTypingTarget(e.target) && !e.shiftKey) return

    // Ctrl+K — 命令片段快速运行（palette）
    if (key === 'k' && !e.shiftKey && !e.altKey) {
      if (!isTerminalContext()) return
      e.preventDefault()
      deps.openSnippetPalette?.()
      return
    }

    // Ctrl+P — 全局跳转面板
    if (key === 'p' && !e.shiftKey && !e.altKey) {
      e.preventDefault()
      deps.openJumpPalette?.()
      return
    }

    // Ctrl+B — SFTP 文件侧栏
    if (key === 'b' && !e.shiftKey) {
      if (!isTerminalContext()) return
      e.preventDefault()
      deps.toggleSidebar()
      return
    }

    // Ctrl+Shift+A — AI 助手
    if (key === 'a' && e.shiftKey) {
      if (!isTerminalContext()) return
      e.preventDefault()
      deps.toggleAiSidebar()
      return
    }

    // Ctrl+Shift+M — 服务器监控
    if (key === 'm' && e.shiftKey) {
      if (!isTerminalContext()) return
      e.preventDefault()
      deps.toggleMonitor()
      return
    }

    // Ctrl+Shift+B — 批量执行
    if (key === 'b' && e.shiftKey) {
      if (!isTerminalContext()) return
      e.preventDefault()
      deps.toggleBatchPanel()
      return
    }

    // Ctrl+Shift+S — 命令片段
    if (key === 's' && e.shiftKey) {
      if (!isTerminalContext()) return
      e.preventDefault()
      deps.toggleSnippetsPanel?.()
      return
    }

    // Ctrl+Shift+D — Docker 工作区（顶栏独立模块，也可从数据库页切过去）
    if (key === 'd' && e.shiftKey) {
      e.preventDefault()
      deps.toggleDocker?.()
      return
    }

    // Ctrl+Shift+T — 新建子会话
    if (key === 't' && e.shiftKey) {
      if (!isTerminalContext()) return
      const group = deps.activeGroup.value
      if (!group) return
      e.preventDefault()
      deps.onAddSession?.(group.connectionId)
      return
    }

    // Ctrl+Tab / Ctrl+Shift+Tab — 切换子会话
    if (key === 'tab' && isTerminalContext()) {
      const group = deps.activeGroup.value
      if (!group || group.sessions.length < 2) return
      e.preventDefault()
      const ids = group.sessions.map((s) => s.id)
      const cur = group.activeSessionId ? ids.indexOf(group.activeSessionId) : 0
      const next = e.shiftKey
        ? (cur - 1 + ids.length) % ids.length
        : (cur + 1) % ids.length
      deps.onSelectSession?.(ids[next])
      return
    }

    // Ctrl+W — 关闭当前连接标签（终端内不拦截）
    if (key === 'w' && !e.shiftKey && isTerminalContext()) {
      if (document.activeElement?.closest('.xterm-container')) return
      e.preventDefault()
      const group = deps.activeGroup.value
      if (group) deps.onCloseGroup(group.connectionId)
    }
  }

  function handleWheel(e: WheelEvent) {
    if (e.ctrlKey || e.metaKey) e.preventDefault()
  }

  /** Capture: cancel Chromium zoom before the default action. Does not stopPropagation. */
  function handlePageZoomKeydown(e: KeyboardEvent) {
    if (isBrowserPageZoomKey(e)) e.preventDefault()
  }

  return { handleKeydown, handleWheel, handlePageZoomKeydown }
}
