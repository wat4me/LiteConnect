import { ref, type Ref } from 'vue'
import type { Terminal } from '@xterm/xterm'
import { createLocalEchoModel, type LocalEchoScreen } from '@/utils/terminal/localEchoModel'

export function useTerminalLocalEcho(
  getTerminal: () => Terminal | null,
  terminalRef: Ref<HTMLDivElement | undefined>,
) {
  const model = createLocalEchoModel()
  const enabled = ref(false)
  const text = ref('')
  const left = ref(0)
  const top = ref(0)
  const cellWidth = ref(8)
  const cellHeight = ref(16)
  const fontSize = ref(14)
  const fontFamily = ref('monospace')
  const color = ref('#ffffff')
  let expiryTimer: ReturnType<typeof setTimeout> | null = null

  function screenState(): LocalEchoScreen | null {
    const terminal = getTerminal()
    if (!terminal) return null
    const buffer = terminal.buffer.active
    const row = buffer.baseY + buffer.cursorY
    const line = buffer.getLine(row)
    if (!line) return null
    return {
      row,
      col: buffer.cursorX,
      cols: terminal.cols,
      normal: buffer.type === 'normal',
      readCells: (start, end) => line.translateToString(false, start, end),
    }
  }

  function placePreview(next: string) {
    text.value = next
    if (expiryTimer) clearTimeout(expiryTimer)
    expiryTimer = null
    if (!next) return
    expiryTimer = setTimeout(clear, 6000)
    const terminal = getTerminal()
    const host = terminalRef.value
    const screen = terminal?.element?.querySelector('.xterm-screen') as HTMLElement | null
    if (!terminal || !host || !screen) {
      clear()
      return
    }
    const buffer = terminal.buffer.active
    const viewportRow = buffer.baseY + buffer.cursorY - buffer.viewportY
    if (viewportRow < 0 || viewportRow >= terminal.rows) {
      clear()
      return
    }
    const core = terminal as unknown as {
      _core?: { _renderService?: { dimensions?: { css?: { cell?: { width: number; height: number } } } } }
    }
    const cell = core._core?._renderService?.dimensions?.css?.cell
    const screenRect = screen.getBoundingClientRect()
    const hostRect = host.getBoundingClientRect()
    const width = cell?.width || screenRect.width / terminal.cols
    const height = cell?.height || screenRect.height / terminal.rows
    left.value = screenRect.left - hostRect.left + buffer.cursorX * width
    top.value = screenRect.top - hostRect.top + viewportRow * height
    cellWidth.value = width
    cellHeight.value = height
    fontSize.value = terminal.options.fontSize || 14
    fontFamily.value = terminal.options.fontFamily || 'monospace'
    color.value = terminal.options.theme?.foreground || '#ffffff'
  }

  function clear() {
    model.clear()
    text.value = ''
    if (expiryTimer) clearTimeout(expiryTimer)
    expiryTimer = null
  }

  function setEnabled(next: boolean) {
    enabled.value = next
    if (!next) clear()
  }

  function onInput(data: string, allowed: boolean) {
    if (!enabled.value) return
    const screen = screenState()
    model.reconcile(screen)
    placePreview(model.input(data, screen, allowed))
  }

  function reconcile() {
    if (!enabled.value || !text.value) return
    placePreview(model.reconcile(screenState()))
  }

  return {
    enabled,
    text,
    left,
    top,
    cellWidth,
    cellHeight,
    fontSize,
    fontFamily,
    color,
    clear,
    setEnabled,
    onInput,
    reconcile,
  }
}
