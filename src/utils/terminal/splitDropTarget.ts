import type { SplitMode, SplitSide } from '@/domain/terminal/types'

export type SplitDropTarget = {
  mode: SplitMode
  side: SplitSide | null
  /** Optional explicit target pane used when dropping one SSH host tab on another. */
  primarySessionId?: string
}

type DropRect = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'>

/** Resolve an edge drop into a split target; the middle is an explicit cancel zone. */
export function resolveSplitDropTarget(
  clientX: number,
  clientY: number,
  rect: DropRect,
): SplitDropTarget | null {
  if (rect.width <= 0 || rect.height <= 0) return null
  const insideX = clientX >= rect.left && clientX <= rect.right
  const insideY = clientY >= rect.top && clientY <= rect.bottom
  if (!insideX || !insideY) return null

  const relX = (clientX - rect.left) / rect.width
  const relY = (clientY - rect.top) / rect.height
  const edge = 0.3
  if (relX >= edge && relX <= 1 - edge && relY >= edge && relY <= 1 - edge) {
    return { mode: 'none', side: null }
  }

  const candidates: Array<{
    distance: number
    mode: Exclude<SplitMode, 'none'>
    side: SplitSide
  }> = []
  if (relX < edge) candidates.push({ distance: relX, mode: 'vertical', side: 'left' })
  if (relX > 1 - edge) candidates.push({ distance: 1 - relX, mode: 'vertical', side: 'right' })
  if (relY < edge) candidates.push({ distance: relY, mode: 'horizontal', side: 'top' })
  if (relY > 1 - edge) candidates.push({ distance: 1 - relY, mode: 'horizontal', side: 'bottom' })
  candidates.sort((a, b) => a.distance - b.distance)
  const target = candidates[0]
  return target ? { mode: target.mode, side: target.side } : { mode: 'none', side: null }
}
