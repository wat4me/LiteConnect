/**
 * dircolors marks other-writable dirs (mode often 777/1777) as blue-on-green:
 *   ow=34;42   (fg blue + bg green)
 *   ow=01;34;42
 * On light terminal themes that pair is often unreadable. We only rewrite that
 * specific SGR combination to black-on-green — other greens/blues are untouched.
 */

/** CSI SGR: ESC [ params m */
const SGR_RE = /\x1b\[([0-9;]*)m/g

const BLUE_FG = new Set([34, 94])
const GREEN_BG = new Set([42, 102])

/**
 * Rewrite SGR param list when it is blue-on-green → black-on-green.
 * Preserves bold/underline/other attrs; only swaps fg 34/94 → 30/90.
 */
export function rewriteOtherWritableSgrParams(params: string): string {
  if (!params) return params
  const parts = params.split(';')
  const codes: number[] = []
  for (const p of parts) {
    if (p === '') continue
    const n = Number(p)
    if (!Number.isFinite(n)) return params
    codes.push(n)
  }
  if (codes.length === 0) return params

  let hasBlueFg = false
  let hasGreenBg = false
  for (const c of codes) {
    if (BLUE_FG.has(c)) hasBlueFg = true
    if (GREEN_BG.has(c)) hasGreenBg = true
  }
  if (!hasBlueFg || !hasGreenBg) return params

  return codes
    .map((c) => {
      if (c === 34) return 30 // blue → black
      if (c === 94) return 90 // bright blue → bright black
      return c
    })
    .join(';')
}

/** Apply other-writable contrast fix to a terminal output chunk. */
export function rewriteOtherWritableAnsi(data: string): string {
  if (!data || data.indexOf('\x1b[') === -1) return data
  return data.replace(SGR_RE, (_full, params: string) => {
    const next = rewriteOtherWritableSgrParams(params)
    return `\x1b[${next}m`
  })
}
