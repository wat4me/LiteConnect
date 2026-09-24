import { describe, expect, it } from 'vitest'
import { createLocalEchoModel, type LocalEchoScreen } from './localEchoModel'

function screen(lineText: string, col = lineText.length, normal = true): LocalEchoScreen {
  return {
    row: 4,
    col,
    cols: 80,
    normal,
    readCells: (start, end) => lineText.slice(start, end).padEnd(end - start),
  }
}

describe('local echo preview', () => {
  it('previews printable input at a shell prompt and reconciles remote echoes', () => {
    const model = createLocalEchoModel()
    const prompt = 'user@host:~$ '
    const waiting = screen(prompt)
    expect(model.input('a', waiting, true)).toBe('a')
    expect(model.input('b', waiting, true)).toBe('ab')
    expect(model.reconcile(screen(`${prompt}a`))).toBe('b')
    expect(model.reconcile(screen(`${prompt}ab`))).toBe('')
    expect(model.input('c', screen(`${prompt}ab`), true)).toBe('c')
  })

  it('does not preview password prompts or alternate-screen programs', () => {
    const model = createLocalEchoModel()
    expect(model.input('s', screen('Password: '), true)).toBe('')
    expect(model.input('s', screen('root@host# ', undefined, false), true)).toBe('')
    expect(model.input('s', screen('token> '), true)).toBe('')
  })

  it('stops on control keys and unexpected server output', () => {
    const model = createLocalEchoModel()
    const prompt = 'user@host:~$ '
    expect(model.input('a', screen(prompt), true)).toBe('a')
    expect(model.input('\r', screen(prompt), true)).toBe('')
    expect(model.input('a', screen(prompt), true)).toBe('a')
    expect(model.reconcile(screen(`${prompt}z`))).toBe('')
    expect(model.input('b', screen(`${prompt}z`), true)).toBe('')
  })

})
