export type AppBackgroundFit = 'cover' | 'contain' | 'fill'

export type AppBackgroundState = {
  /** Custom-scheme URL, or a temporary data URL while a pick is staged */
  imageUrl: string
  fit: AppBackgroundFit
  overlay: number
  /** Display name of selected file (draft only) */
  fileName: string
  /** One-time token from the file picker (never a filesystem path) */
  token: string
  /** User cleared image in draft (persisted on save) */
  cleared: boolean
}

export function sanitizeAppBackgroundFit(v: unknown): AppBackgroundFit {
  if (v === 'contain' || v === 'fill' || v === 'cover') return v
  return 'cover'
}

export function clampBackgroundOverlay(n: unknown): number {
  const v = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(v)) return 55
  return Math.max(0, Math.min(90, Math.round(v)))
}

export function emptyAppBackgroundState(): AppBackgroundState {
  return {
    imageUrl: '',
    fit: 'cover',
    overlay: 55,
    fileName: '',
    token: '',
    cleared: false,
  }
}

/**
 * Apply wallpaper to document root. Empty imageUrl clears the image layer.
 */
export function applyAppBackground(opts: {
  imageUrl?: string
  /** @deprecated use imageUrl */
  dataUrl?: string
  fit?: AppBackgroundFit
  overlay?: number
}): void {
  const root = document.documentElement
  const imageUrl = (opts.imageUrl || opts.dataUrl || '').trim()
  const fit = sanitizeAppBackgroundFit(opts.fit)
  const overlay = clampBackgroundOverlay(opts.overlay)

  if (!imageUrl) {
    root.classList.remove('has-app-bg')
    root.style.removeProperty('--app-bg-image')
    root.style.removeProperty('--app-bg-size')
    root.style.removeProperty('--app-bg-overlay')
    root.style.removeProperty('--app-bg-terminal-alpha')
    return
  }

  const size = fit === 'fill' ? '100% 100%' : fit
  // Terminal canvas alpha: slightly more see-through when UI overlay is lower
  const terminalAlpha = Math.round((0.82 + (overlay / 90) * 0.12) * 100) / 100
  root.classList.add('has-app-bg')
  root.style.setProperty('--app-bg-image', `url("${imageUrl.replace(/"/g, '\\"')}")`)
  root.style.setProperty('--app-bg-size', size)
  root.style.setProperty('--app-bg-overlay', `${overlay}%`)
  root.style.setProperty('--app-bg-terminal-alpha', String(terminalAlpha))
}

/** Whether wallpaper is currently active on the document. */
export function hasAppBackground(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('has-app-bg')
}

/**
 * Terminal bg alpha when wallpaper is on (0.82–0.94). Null when wallpaper off.
 * Higher overlay (more theme veil) → slightly more opaque terminal.
 */
export function getTerminalWallpaperAlpha(): number | null {
  if (!hasAppBackground()) return null
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue('--app-bg-terminal-alpha')
    .trim()
  const n = parseFloat(raw)
  if (Number.isFinite(n) && n > 0 && n <= 1) return n
  return 0.78
}

function colorWithAlpha(color: string, alpha: number): string {
  const c = (color || '').trim()
  if (!c) return `rgba(0, 0, 0, ${alpha})`

  // #rgb / #rrggbb
  if (c.startsWith('#')) {
    let h = c.slice(1)
    if (h.length === 3) {
      h = h
        .split('')
        .map((ch) => ch + ch)
        .join('')
    }
    if (h.length === 6) {
      const r = parseInt(h.slice(0, 2), 16)
      const g = parseInt(h.slice(2, 4), 16)
      const b = parseInt(h.slice(4, 6), 16)
      if ([r, g, b].every((n) => Number.isFinite(n))) {
        return `rgba(${r}, ${g}, ${b}, ${alpha})`
      }
    }
  }

  // rgb(r,g,b) / rgba(r,g,b,a)
  const m = c.match(
    /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*[\d.]+\s*)?\)$/i,
  )
  if (m) {
    return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`
  }

  return c
}

/**
 * When wallpaper is on, make xterm background semi-transparent so the image
 * shows through the session area (not only chrome around it).
 */
export function withWallpaperTerminalTheme<T extends Record<string, string>>(
  colors: T,
): T {
  const alpha = getTerminalWallpaperAlpha()
  if (alpha == null) return colors
  const bg = colors.background
  if (!bg) return colors
  return {
    ...colors,
    background: colorWithAlpha(bg, alpha),
  }
}
