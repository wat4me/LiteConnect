import { onBeforeUnmount, onMounted } from 'vue'
import type { SplitMode, SplitSide } from '@/domain/terminal/types'

export type TerminalSplitKeyboardDeps = {
  workspaceVisible: () => boolean
  dockerTabActive: () => boolean
  container: () => HTMLElement | null
  canUseLayoutButtons: () => boolean
  isSplit: () => boolean
  splitMode: () => SplitMode
  splitHasSecondary: () => boolean
  primarySessionId: () => string | null
  secondarySessionId: () => string | null
  secondarySide: () => SplitSide
  toggleVertical: () => void
  toggleHorizontal: () => void
  clearMaximize: () => void
  focusSession: (sessionId: string) => void
}

export function createTerminalSplitShortcutHandler(deps: TerminalSplitKeyboardDeps) {
  function onTerminalSplitShortcut(event: KeyboardEvent) {
    if (!deps.workspaceVisible() || deps.dockerTabActive()) return
    const eventTarget = event.target as Node | null
    if (!eventTarget || !deps.container()?.contains(eventTarget)) return

    if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) {
      if (event.repeat || (event.code !== 'Backslash' && event.code !== 'Minus')) return
      if (!deps.canUseLayoutButtons()) return
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Backslash' && (!deps.isSplit() || deps.splitMode() !== 'vertical')) {
        deps.toggleVertical()
      } else if (event.code === 'Minus' && (!deps.isSplit() || deps.splitMode() !== 'horizontal')) {
        deps.toggleHorizontal()
      }
      return
    }

    if (!event.altKey || event.ctrlKey || event.metaKey || !deps.splitHasSecondary()) return
    const secondaryId = deps.secondarySessionId()
    const primaryId = deps.primarySessionId()
    if (!secondaryId || !primaryId) return

    let targetId: string | null = null
    if (deps.splitMode() === 'vertical' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      const targetSide = event.key === 'ArrowLeft' ? 'left' : 'right'
      targetId = deps.secondarySide() === targetSide ? secondaryId : primaryId
    } else if (deps.splitMode() === 'horizontal' && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      const targetSide = event.key === 'ArrowUp' ? 'top' : 'bottom'
      targetId = deps.secondarySide() === targetSide ? secondaryId : primaryId
    }
    if (!targetId) return
    event.preventDefault()
    event.stopPropagation()
    deps.clearMaximize()
    deps.focusSession(targetId)
  }

  return onTerminalSplitShortcut
}

export function useTerminalSplitKeyboard(deps: TerminalSplitKeyboardDeps) {
  const onTerminalSplitShortcut = createTerminalSplitShortcutHandler(deps)
  onMounted(() => window.addEventListener('keydown', onTerminalSplitShortcut, true))
  onBeforeUnmount(() => window.removeEventListener('keydown', onTerminalSplitShortcut, true))
}
