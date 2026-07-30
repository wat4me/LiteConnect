/**
 * Keep fixed/absolute popups (context menus, dropdowns) fully inside the viewport.
 * Prefer flipping above the anchor when the bottom would overflow.
 */

export type PopupPoint = { x: number; y: number }
export type PopupSize = { width: number; height: number }

export type ClampPopupOptions = {
  /** Distance from viewport edges. Default 8. */
  padding?: number
  /**
   * When overflowing the bottom edge, try placing the popup above `preferred.y`
   * (cursor / anchor) if there is room. Default true.
   */
  flip?: boolean
  /** Override viewport size (for tests). */
  viewport?: PopupSize
}

export type ClampedPopupPosition = {
  left: number
  top: number
}

function viewportSize(override?: PopupSize): PopupSize {
  if (override) return override
  if (typeof window === 'undefined') return { width: 1920, height: 1080 }
  return { width: window.innerWidth, height: window.innerHeight }
}

/**
 * Clamp a preferred top-left point so a box of `size` stays inside the viewport.
 */
export function clampPopupToViewport(
  preferred: PopupPoint,
  size: PopupSize,
  options: ClampPopupOptions = {},
): ClampedPopupPosition {
  const padding = options.padding ?? 8
  const flip = options.flip !== false
  const { width: vw, height: vh } = viewportSize(options.viewport)
  const w = Math.max(0, size.width || 0)
  const h = Math.max(0, size.height || 0)

  let left = preferred.x
  let top = preferred.y

  // Horizontal: keep fully visible; if wider than viewport, pin to left padding.
  if (w + padding * 2 >= vw) {
    left = padding
  } else {
    if (left + w > vw - padding) left = vw - padding - w
    if (left < padding) left = padding
  }

  // Vertical
  if (h + padding * 2 >= vh) {
    top = padding
  } else if (top + h > vh - padding) {
    if (flip) {
      const above = preferred.y - h
      if (above >= padding) {
        top = above
      } else {
        top = Math.max(padding, vh - padding - h)
      }
    } else {
      top = Math.max(padding, vh - padding - h)
    }
  }
  if (top < padding) top = padding

  return { left: Math.round(left), top: Math.round(top) }
}

/**
 * Measure a mounted element and return viewport-safe fixed coordinates.
 */
export function fitFixedElement(
  el: HTMLElement,
  preferred: PopupPoint,
  options: ClampPopupOptions = {},
): ClampedPopupPosition {
  const rect = el.getBoundingClientRect()
  return clampPopupToViewport(
    preferred,
    { width: rect.width, height: rect.height },
    options,
  )
}

/**
 * Position a popup relative to an anchor rect (e.g. button), preferring below
 * and aligning to the given edge. Useful for dropdowns.
 */
export function placePopupNearAnchor(
  anchor: { left: number; top: number; right: number; bottom: number; width: number; height: number },
  size: PopupSize,
  options: ClampPopupOptions & {
    gap?: number
    /** Align popup's right edge to anchor's right edge when true. */
    align?: 'start' | 'end' | 'center'
    /** Prefer opening below (default) or above the anchor. */
    prefer?: 'below' | 'above'
  } = {},
): ClampedPopupPosition & { maxHeight: number; openAbove: boolean } {
  const padding = options.padding ?? 8
  const gap = options.gap ?? 4
  const align = options.align ?? 'start'
  const prefer = options.prefer ?? 'below'
  const { width: vw, height: vh } = viewportSize(options.viewport)
  const w = Math.max(0, size.width || 0)
  const h = Math.max(0, size.height || 0)

  let left =
    align === 'end'
      ? anchor.right - w
      : align === 'center'
        ? anchor.left + anchor.width / 2 - w / 2
        : anchor.left

  if (w + padding * 2 >= vw) left = padding
  else {
    if (left + w > vw - padding) left = vw - padding - w
    if (left < padding) left = padding
  }

  const spaceBelow = vh - anchor.bottom - gap - padding
  const spaceAbove = anchor.top - gap - padding
  const openAbove =
    prefer === 'above'
      ? spaceAbove >= Math.min(h, spaceBelow) || spaceAbove > spaceBelow
      : h > spaceBelow && spaceAbove > spaceBelow

  let top: number
  let maxHeight: number
  if (openAbove) {
    maxHeight = Math.max(0, Math.floor(spaceAbove))
    const usedH = h > 0 ? Math.min(h, maxHeight || h) : 0
    top = h > 0 ? anchor.top - gap - usedH : Math.max(padding, anchor.top - gap)
    if (top < padding) top = padding
  } else {
    maxHeight = Math.max(0, Math.floor(spaceBelow))
    top = anchor.bottom + gap
    if (h > 0 && top + Math.min(h, maxHeight || h) > vh - padding) {
      top = Math.max(padding, vh - padding - Math.min(h, maxHeight || h))
    }
  }

  return {
    left: Math.round(left),
    top: Math.round(top),
    maxHeight,
    openAbove,
  }
}

/** Style object for Vue `:style` bindings. */
export function popupStyleFromPosition(
  pos: ClampedPopupPosition,
  extra?: Record<string, string>,
): Record<string, string> {
  return {
    left: `${pos.left}px`,
    top: `${pos.top}px`,
    ...extra,
  }
}
