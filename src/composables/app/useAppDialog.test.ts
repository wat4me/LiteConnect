import { afterEach, describe, expect, it } from 'vitest'
import {
  appConfirm,
  appDialogCancel,
  appDialogConfirm,
  appPrompt,
  useAppDialogMutable,
} from './useAppDialog'

const state = useAppDialogMutable()
afterEach(() => { if (state.visible) appDialogCancel() })

describe('editable command prompts', () => {
  it('preserves complete edited scripts, indentation and trailing newlines', async () => {
    const original = '  echo original\n'.repeat(100)
    const result = appPrompt({
      title: 'Paste', inputValue: original, multiline: true, trimInput: false, maxLength: null,
    })
    expect(state.inputValue).toBe(original)
    expect(state.maxLength).toBeNull()
    const edited = '  echo edited\n\tprintf "done"  \n'
    state.inputValue = edited
    appDialogConfirm()
    await expect(result).resolves.toBe(edited)
  })

  it('keeps empty edits open for correction and allows cancellation', async () => {
    const result = appPrompt({ title: 'Paste', multiline: true, trimInput: false })
    const cancelled = expect(result).rejects.toBe('cancel')
    state.inputValue = ' \n\t'
    appDialogConfirm()
    expect(state.visible).toBe(true)
    expect(state.inputError).not.toBe('')
    appDialogCancel()
    await cancelled
  })

  it('preserves existing single-line prompt defaults after a command editor', async () => {
    const script = appPrompt({ title: 'Paste', multiline: true, trimInput: false, maxLength: null, tone: 'warning' })
    state.inputValue = 'echo ok'
    appDialogConfirm()
    await script
    const name = appPrompt({ title: 'Name', inputValue: '  group  ' })
    expect(state.multiline).toBe(false)
    expect(state.maxLength).toBe(200)
    expect(state.tone).toBe('info')
    appDialogConfirm()
    await expect(name).resolves.toBe('group')
  })

  it('cancels the previous dialog when a second paste opens', async () => {
    const first = appPrompt({ title: 'First paste' })
    const cancelled = expect(first).rejects.toBe('cancel')
    const second = appPrompt({ title: 'Second paste', inputValue: 'echo second' })
    appDialogConfirm()
    await cancelled
    await expect(second).resolves.toBe('echo second')
  })

  it('can replace a command editor with a confirmation', async () => {
    const editor = appPrompt({ title: 'Paste', multiline: true })
    const cancelled = expect(editor).rejects.toBe('cancel')
    const confirm = appConfirm({ title: 'Confirm', message: 'Continue?' })
    expect(state.multiline).toBe(false)
    appDialogConfirm()
    await cancelled
    await expect(confirm).resolves.toBe('confirm')
  })
})
