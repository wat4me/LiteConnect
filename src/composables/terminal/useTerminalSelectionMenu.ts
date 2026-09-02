import { nextTick, ref } from 'vue'
import type { Terminal } from '@xterm/xterm'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'
import { fitFixedElement } from '@/utils/shared/popupPosition'

export function useTerminalSelectionMenu(deps: {
  getTerminal: () => Terminal | null
  isActive: () => boolean
  pasteWithConfirm: (text: string) => Promise<void>
  onAiSelection: (text: string, mode: 'send' | 'insert') => void
  onSaveAsSnippet: (text: string) => void
}) {
  const selectionMenuVisible = ref(false)
  const selectionMenuX = ref(0)
  const selectionMenuY = ref(0)
  const selectionMenuRef = ref<HTMLElement | null>(null)
  const selectedText = ref('')
  let selectionMenuPreferred = { x: 0, y: 0 }

  function hideSelectionMenu() {
    selectionMenuVisible.value = false
  }

  useOutsideDismiss(
    () => selectionMenuVisible.value,
    hideSelectionMenu,
    () => [selectionMenuRef.value],
  )

  async function repositionSelectionMenu() {
    await nextTick()
    const el = selectionMenuRef.value
    if (!el || !selectionMenuVisible.value) return
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })
    if (!selectionMenuRef.value || !selectionMenuVisible.value) return
    const pos = fitFixedElement(selectionMenuRef.value, selectionMenuPreferred)
    selectionMenuX.value = pos.left
    selectionMenuY.value = pos.top
  }

  function openSelectionMenu(event: MouseEvent) {
    const terminal = deps.getTerminal()
    if (!terminal) return
    event.preventDefault()
    event.stopPropagation()
    const text = terminal.hasSelection() ? terminal.getSelection().trim() : ''
    selectedText.value = text
    selectionMenuPreferred = { x: event.clientX, y: event.clientY }
    selectionMenuX.value = event.clientX
    selectionMenuY.value = event.clientY
    selectionMenuVisible.value = true
    void repositionSelectionMenu()
  }

  function copySelection() {
    const terminal = deps.getTerminal()
    const text = selectedText.value || (terminal?.hasSelection() ? terminal?.getSelection() : '') || ''
    if (!text) return
    window.LiteConnect.clipboardWriteText(text).catch(() => {})
    hideSelectionMenu()
  }

  async function pasteToTerminal() {
    const terminal = deps.getTerminal()
    hideSelectionMenu()
    try {
      const text = await window.LiteConnect.clipboardReadText()
      if (text) await deps.pasteWithConfirm(text)
    } catch {
      // Clipboard read/cancel should not leave the terminal unfocused.
    } finally {
      await nextTick()
      if (deps.isActive() && terminal && deps.getTerminal() === terminal) terminal.focus()
    }
  }

  function selectAllInTerminal() {
    deps.getTerminal()?.selectAll()
    hideSelectionMenu()
  }

  function sendSelectionToAi(mode: 'send' | 'insert') {
    const text = selectedText.value || deps.getTerminal()?.getSelection()?.trim() || ''
    if (!text) return
    deps.onAiSelection(text, mode)
    hideSelectionMenu()
  }

  function saveSelectionAsSnippet() {
    const text = selectedText.value || deps.getTerminal()?.getSelection()?.trim() || ''
    if (!text) return
    deps.onSaveAsSnippet(text)
    hideSelectionMenu()
  }

  return {
    selectionMenuVisible,
    selectionMenuX,
    selectionMenuY,
    selectionMenuRef,
    selectedText,
    hideSelectionMenu,
    openSelectionMenu,
    copySelection,
    pasteToTerminal,
    selectAllInTerminal,
    sendSelectionToAi,
    saveSelectionAsSnippet,
  }
}
