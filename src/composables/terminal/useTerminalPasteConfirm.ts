import { nextTick, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Terminal } from '@xterm/xterm'
import { ElMessage } from 'element-plus/es/components/message/index'
import { appPrompt } from '@/composables/app/useAppDialog'
import { CLIPBOARD_MAX_CHARS, CLIPBOARD_TOO_LARGE_ERROR } from '@shared/clipboard'
import {
  LARGE_TERMINAL_PASTE_BYTES,
  normalizeTerminalText,
  shouldConfirmPaste,
  terminalPasteBytes,
} from '@/utils/terminal/terminalPaste'

export function useTerminalPasteConfirm(deps: {
  getTerminal: () => Terminal | null
  pasteConfirmEnabled: Ref<boolean>
  pasteConfirmMaxChars: Ref<number>
  isActive: () => boolean
  /** An additional byte limit for transports without renderer-side chunking. */
  maxPasteBytes?: number
}) {
  const { t } = useI18n()

  function pasteToTerminal(text: string) {
    if (!text) return
    // xterm honors the remote application's bracketed-paste mode, reveals the
    // prompt and forwards exactly once through the existing onData handler.
    deps.getTerminal()?.paste(text)
  }

  const isProtected = (terminal: Terminal) =>
    terminal.modes.bracketedPasteMode && !terminal.options.ignoreBracketedPasteMode

  function limitError(text: string, terminal: Terminal): string | null {
    if (text.length > CLIPBOARD_MAX_CHARS) {
      return t('terminal.pasteTooLargeChars', { max: CLIPBOARD_MAX_CHARS.toLocaleString() })
    }
    if (deps.maxPasteBytes !== undefined && terminalPasteBytes(text, isProtected(terminal)) > deps.maxPasteBytes) {
      return t('terminal.pasteTooLargeBytes', { max: Math.floor(deps.maxPasteBytes / 1024) })
    }
    return null
  }

  function showPasteError(message: string) {
    ElMessage.warning({ message, duration: 8000, showClose: true })
  }

  async function pasteWithConfirm(text: string) {
    const terminal = deps.getTerminal()
    if (!terminal || !text) return
    try {
      const error = limitError(text, terminal)
      if (error) {
        showPasteError(error)
        return
      }
      let content = text
      const largePaste = terminalPasteBytes(content, isProtected(terminal)) >= LARGE_TERMINAL_PASTE_BYTES
      if (largePaste || (deps.pasteConfirmEnabled.value && shouldConfirmPaste(content, deps.pasteConfirmMaxChars.value))) {
        let acknowledgedUnprotected = false
        let acknowledgedLarge = false
        do {
          const protectedPaste = isProtected(terminal)
          const pasteBytes = terminalPasteBytes(content, protectedPaste)
          const largeHint = pasteBytes >= LARGE_TERMINAL_PASTE_BYTES
            ? `${t('terminal.pasteLargeHint', { size: Math.ceil(pasteBytes / 1024) })}\n`
            : ''
          content = await appPrompt({
            title: t('terminal.pasteConfirmTitle'),
            message: `${largeHint}${t(protectedPaste ? 'terminal.pasteProtectedHint' : 'terminal.pasteUnprotectedHint')}\n${t('terminal.pasteEditHint')}`,
            inputValue: normalizeTerminalText(content),
            multiline: true,
            trimInput: false,
            maxLength: null,
            validate: (value) => limitError(value, terminal) || true,
            confirmText: t(protectedPaste ? 'terminal.pasteConfirmAction' : 'terminal.pasteAnyway'),
            cancelText: t('common.cancel'),
            tone: 'warning',
          })
          if (deps.getTerminal() !== terminal || !deps.isActive()) return
          acknowledgedUnprotected = !protectedPaste
          acknowledgedLarge = pasteBytes >= LARGE_TERMINAL_PASTE_BYTES
          // If the remote program changed while editing, show the fallback
          // behavior before sending text that could now execute on newlines.
        } while ((!isProtected(terminal) && !acknowledgedUnprotected)
          || (terminalPasteBytes(content, isProtected(terminal)) >= LARGE_TERMINAL_PASTE_BYTES && !acknowledgedLarge))
      }
      if (deps.getTerminal() !== terminal || !deps.isActive()) return
      const finalError = limitError(content, terminal)
      if (finalError) {
        showPasteError(finalError)
        return
      }
      pasteToTerminal(content)
    } catch {
      // User cancelled the confirmation.
    } finally {
      await nextTick()
      if (deps.isActive() && deps.getTerminal() === terminal) terminal.focus()
    }
  }

  async function pasteFromClipboard() {
    try {
      const text = await window.LiteConnect.clipboardReadText()
      if (text) await pasteWithConfirm(text)
    } catch (error) {
      showPasteError(String(error).includes(CLIPBOARD_TOO_LARGE_ERROR)
        ? t('terminal.pasteTooLargeChars', { max: CLIPBOARD_MAX_CHARS.toLocaleString() })
        : t('terminal.pasteClipboardFailed'))
    }
  }

  function handlePasteEvent(event: ClipboardEvent) {
    const text = event.clipboardData?.getData('text/plain')
    if (!text) return
    event.preventDefault()
    event.stopImmediatePropagation()
    void pasteWithConfirm(text)
  }

  return { pasteWithConfirm, pasteFromClipboard, handlePasteEvent }
}
