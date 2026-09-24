export type LocalEchoScreen = {
  row: number
  col: number
  cols: number
  normal: boolean
  readCells: (start: number, end: number) => string
}

type Epoch = {
  row: number
  col: number
  typed: string
  confirmed: number
}

const SECRET_PROMPT = /password|passphrase|secret|token|\bpin\b|\botp\b|密码|口令|验证码/i
const SHELL_PROMPT = /(?:[$#%]|>{1,3}) ?$/

/** Predicted cells are never written into xterm's authoritative buffer. */
export function createLocalEchoModel() {
  let epoch: Epoch | null = null

  function clear(): string {
    epoch = null
    return ''
  }

  function input(data: string, screen: LocalEchoScreen | null, allowed: boolean): string {
    if (!allowed || !screen || !screen.normal) return clear()
    if (data.length !== 1 || data.charCodeAt(0) < 0x20 || data.charCodeAt(0) > 0x7e) return clear()
    if (screen.col >= screen.cols - 1) return clear()

    if (!epoch) {
      const prefix = screen.readCells(0, screen.col)
      if (SECRET_PROMPT.test(prefix) || !SHELL_PROMPT.test(prefix)) return ''
      epoch = { row: screen.row, col: screen.col, typed: '', confirmed: 0 }
    } else if (screen.row !== epoch.row || screen.col !== epoch.col + epoch.confirmed) {
      return clear()
    }

    if (epoch.col + epoch.typed.length >= screen.cols - 1) return clear()
    epoch.typed += data
    return epoch.typed.slice(epoch.confirmed)
  }

  function reconcile(screen: LocalEchoScreen | null): string {
    if (!epoch) return ''
    if (!screen || !screen.normal || screen.row !== epoch.row) return clear()
    const count = screen.col - epoch.col
    if (count < epoch.confirmed || count > epoch.typed.length) return clear()
    if (screen.readCells(epoch.col, epoch.col + count) !== epoch.typed.slice(0, count)) {
      return clear()
    }
    epoch.confirmed = count
    return epoch.typed.slice(count)
  }

  return { input, reconcile, clear }
}
