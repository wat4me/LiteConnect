import { ref } from 'vue'
import type { Terminal } from '@xterm/xterm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ElMessage } from 'element-plus/es/components/message/index'
import { CLIPBOARD_MAX_CHARS, CLIPBOARD_TOO_LARGE_ERROR } from '@shared/clipboard'
import { appPrompt } from '@/composables/app/useAppDialog'
import { useTerminalPasteConfirm } from './useTerminalPasteConfirm'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('@/i18n', () => ({ t: (key: string) => key }))
vi.mock('@/composables/app/useAppDialog', () => ({ appPrompt: vi.fn() }))
vi.mock('element-plus/es/components/message/index', () => ({ ElMessage: { warning: vi.fn() } }))

function setup(protectedPaste = true, maxPasteBytes?: number) {
  const terminal = {
    modes: { bracketedPasteMode: protectedPaste },
    options: { ignoreBracketedPasteMode: false },
    paste: vi.fn(), focus: vi.fn(),
  }
  let current: Terminal | null = terminal as unknown as Terminal
  let active = true
  const enabled = ref(true)
  const api = useTerminalPasteConfirm({
    getTerminal: () => current, pasteConfirmEnabled: enabled,
    pasteConfirmMaxChars: ref(400), isActive: () => active,
    maxPasteBytes,
  })
  return { api, terminal, enabled, close: () => { current = null }, hide: () => { active = false } }
}

beforeEach(() => {
  vi.mocked(appPrompt).mockReset()
  vi.mocked(ElMessage.warning).mockClear()
})
afterEach(() => vi.unstubAllGlobals())

describe('terminal paste protection', () => {
  it('uses native paste semantics for the complete edited text', async () => {
    const state = setup()
    const edited = '  echo edited\n\tprintf done\n'
    vi.mocked(appPrompt).mockResolvedValue(edited)
    await state.api.pasteWithConfirm('echo a\r\necho b\r\n')
    expect(appPrompt).toHaveBeenCalledWith(expect.objectContaining({
      inputValue: 'echo a\necho b\n', trimInput: false, maxLength: null,
      confirmText: 'terminal.pasteConfirmAction',
      message: expect.stringContaining('terminal.pasteProtectedHint'),
    }))
    expect(state.terminal.paste).toHaveBeenCalledExactlyOnceWith(edited)
  })

  it('clearly describes unprotected fallback before sending', async () => {
    const state = setup(false)
    vi.mocked(appPrompt).mockResolvedValue('echo a\necho b')
    await state.api.pasteWithConfirm('echo a\necho b')
    expect(appPrompt).toHaveBeenCalledWith(expect.objectContaining({
      confirmText: 'terminal.pasteAnyway',
      message: expect.stringContaining('terminal.pasteUnprotectedHint'),
    }))
    expect(state.terminal.paste).toHaveBeenCalledOnce()
  })

  it('asks again if protection was disabled while the editor was open', async () => {
    const state = setup()
    vi.mocked(appPrompt).mockImplementationOnce(async () => {
      state.terminal.modes.bracketedPasteMode = false
      return 'echo edited\necho b'
    }).mockRejectedValueOnce('cancel')
    await state.api.pasteWithConfirm('echo a\necho b')
    expect(appPrompt).toHaveBeenCalledTimes(2)
    expect(appPrompt).toHaveBeenLastCalledWith(expect.objectContaining({
      inputValue: 'echo edited\necho b', confirmText: 'terminal.pasteAnyway',
    }))
    expect(state.terminal.paste).not.toHaveBeenCalled()
  })

  it.each(['close', 'hide'] as const)('does not send if the terminal becomes unavailable: %s', async action => {
    const state = setup()
    vi.mocked(appPrompt).mockImplementation(async () => {
      state[action]()
      return 'echo a\necho b'
    })
    await state.api.pasteWithConfirm('echo a\necho b')
    expect(state.terminal.paste).not.toHaveBeenCalled()
  })

  it('still honors the disabled-confirmation setting and uses native paste', async () => {
    const state = setup()
    state.enabled.value = false
    await state.api.pasteWithConfirm('echo a\necho b\n')
    expect(appPrompt).not.toHaveBeenCalled()
    expect(state.terminal.paste).toHaveBeenCalledExactlyOnceWith('echo a\necho b\n')
  })

  it('warns about large pastes even when routine confirmation is disabled', async () => {
    const state = setup()
    state.enabled.value = false
    const text = 'x'.repeat(64 * 1024)
    vi.mocked(appPrompt).mockRejectedValue('cancel')
    await state.api.pasteWithConfirm(text)
    expect(appPrompt).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('terminal.pasteLargeHint'), inputValue: text,
    }))
    expect(state.terminal.paste).not.toHaveBeenCalled()
  })

  it('rejects text above the character limit without sending a prefix', async () => {
    const state = setup()
    await state.api.pasteWithConfirm('x'.repeat(CLIPBOARD_MAX_CHARS + 1))
    expect(ElMessage.warning).toHaveBeenCalledWith(expect.objectContaining({ message: 'terminal.pasteTooLargeChars' }))
    expect(appPrompt).not.toHaveBeenCalled()
    expect(state.terminal.paste).not.toHaveBeenCalled()
  })

  it('checks UTF-8 bytes and bracket overhead against the container write limit', async () => {
    const state = setup(true, 64 * 1024)
    const text = '中'.repeat(21845)
    // 65535 bytes of content plus the 12-byte paste markers exceeds 64 KiB.
    await state.api.pasteWithConfirm(text)
    expect(ElMessage.warning).toHaveBeenCalledWith(expect.objectContaining({ message: 'terminal.pasteTooLargeBytes' }))
    expect(state.terminal.paste).not.toHaveBeenCalled()
  })

  it('validates edited content before the editor can submit it', async () => {
    const state = setup(true, 64 * 1024)
    vi.mocked(appPrompt).mockImplementation(async options => {
      expect(options.validate?.('x'.repeat(64 * 1024))).toBe('terminal.pasteTooLargeBytes')
      expect(options.validate?.('echo valid')).toBe(true)
      return 'echo valid'
    })
    await state.api.pasteWithConfirm('echo a\necho b')
    expect(state.terminal.paste).toHaveBeenCalledExactlyOnceWith('echo valid')
  })

  it('shows the large-paste warning if editing grows a normal paste beyond the threshold', async () => {
    const state = setup()
    const text = 'x'.repeat(64 * 1024)
    vi.mocked(appPrompt).mockResolvedValueOnce(text).mockRejectedValueOnce('cancel')
    await state.api.pasteWithConfirm('echo a\necho b')
    expect(appPrompt).toHaveBeenCalledTimes(2)
    expect(appPrompt).toHaveBeenLastCalledWith(expect.objectContaining({
      message: expect.stringContaining('terminal.pasteLargeHint'), inputValue: text,
    }))
    expect(state.terminal.paste).not.toHaveBeenCalled()
  })

  it('reports IPC clipboard size rejection instead of silently treating it as a cancelled paste', async () => {
    const state = setup()
    vi.stubGlobal('window', { LiteConnect: {
      clipboardReadText: vi.fn().mockRejectedValue(new Error(`Error invoking clipboard:readText: ${CLIPBOARD_TOO_LARGE_ERROR}`)),
    } })
    await state.api.pasteFromClipboard()
    expect(ElMessage.warning).toHaveBeenCalledWith(expect.objectContaining({ message: 'terminal.pasteTooLargeChars' }))
    expect(state.terminal.paste).not.toHaveBeenCalled()
  })
})
