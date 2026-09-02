import { nextTick, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { Terminal } from '@xterm/xterm'
import { appConfirm } from '@/composables/app/useAppDialog'
import {
  buildPastePreview,
  countPasteLines,
  shouldConfirmPaste,
} from '@/utils/terminal/terminalPaste'

export function useTerminalPasteConfirm(deps: {
  getTerminal: () => Terminal | null
  pasteConfirmEnabled: Ref<boolean>
  pasteConfirmMaxChars: Ref<number>
  isActive: () => boolean
  handleTerminalUserInput: (data: string) => void
}) {
  const { t } = useI18n()

  function pasteAsTypedInput(text: string) {
    if (!text) return
    const payload = text.replace(/\r\n/g, '\r').replace(/\n/g, '\r')
    deps.handleTerminalUserInput(payload)
  }

  async function pasteWithConfirm(text: string) {
    const terminal = deps.getTerminal()
    if (!terminal || !text) return
    try {
      if (deps.pasteConfirmEnabled.value && shouldConfirmPaste(text, deps.pasteConfirmMaxChars.value)) {
        const lines = countPasteLines(text)
        await appConfirm({
          title: t('terminal.pasteConfirmTitle'),
          message: t('terminal.pasteConfirmMessage', { lines, chars: text.length }),
          detail: buildPastePreview(text),
          confirmText: t('terminal.pasteConfirmAction'),
          cancelText: t('common.cancel'),
          tone: 'warning',
        })
      }
      pasteAsTypedInput(text)
    } catch {
      // User cancelled the confirmation.
    } finally {
      await nextTick()
      if (deps.isActive() && deps.getTerminal() === terminal) terminal.focus()
    }
  }

  return { pasteAsTypedInput, pasteWithConfirm }
}
