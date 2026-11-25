export interface HighlightCellLike {
  getChars(): string
  getWidth(): number
}

export interface HighlightLineLike {
  length: number
  getCell(x: number): HighlightCellLike | undefined
}

export interface SelectionRange {
  startX: number
  startY: number
  endX: number
  endY: number
}

export interface OccurrenceMatch {
  x: number
  width: number
}

export const MIN_SELECTION_OCCURRENCE_LEN = 2
export const MAX_SELECTION_OCCURRENCE_LEN = 120

/**
 * Return the normalized search needle if the selection is eligible for occurrence highlighting,
 * or null if it should not trigger highlighting (empty, single char, multi-line, whitespace-only, or too long).
 */
export function normalizeSelectionOccurrenceNeedle(selection: string): string | null {
  if (!selection) return null
  if (selection.includes('\n') || selection.includes('\r')) return null
  const trimmed = selection.trim()
  if (trimmed.length < MIN_SELECTION_OCCURRENCE_LEN || trimmed.length > MAX_SELECTION_OCCURRENCE_LEN) {
    return null
  }
  return trimmed
}

/**
 * Find all cell-accurate occurrences of `needle` in a single xterm buffer line,
 * skipping any match that overlaps the user's active selection range on `rowIndex`.
 */
export function findLineOccurrences(
  line: HighlightLineLike,
  rowIndex: number,
  needle: string,
  activeSelection?: SelectionRange | null,
  maxMatches = 64,
): OccurrenceMatch[] {
  if (!needle) return []

  // Build text along with per-code-unit starting column and cell width so CJK / wide chars align accurately.
  let text = ''
  const unitStartCol: number[] = []
  const unitEndCol: number[] = []
  let lastNonSpaceLen = 0

  for (let col = 0; col < line.length; col++) {
    const cell = line.getCell(col)
    if (!cell) continue
    const width = cell.getWidth()
    // width === 0 is the trailing placeholder cell of a wide character
    if (width === 0) continue
    const chars = cell.getChars() || ' '
    for (let i = 0; i < chars.length; i++) {
      unitStartCol.push(col)
      unitEndCol.push(col + width)
    }
    text += chars
    if (chars !== ' ') lastNonSpaceLen = text.length
  }

  if (lastNonSpaceLen === 0) return []
  const effectiveText = text.slice(0, lastNonSpaceLen)
  const matches: OccurrenceMatch[] = []
  let searchFrom = 0

  while (matches.length < maxMatches) {
    const idx = effectiveText.indexOf(needle, searchFrom)
    if (idx < 0) break
    const endIdx = idx + needle.length - 1
    const startCol = unitStartCol[idx]
    const endCol = unitEndCol[endIdx]
    const width = endCol - startCol

    let overlapsSelection = false
    if (activeSelection && rowIndex >= activeSelection.startY && rowIndex <= activeSelection.endY) {
      const selStart = rowIndex === activeSelection.startY ? activeSelection.startX : 0
      const selEnd = rowIndex === activeSelection.endY ? activeSelection.endX : line.length
      overlapsSelection = startCol < selEnd && endCol > selStart
    }

    if (!overlapsSelection && width > 0) {
      matches.push({ x: startCol, width })
    }
    searchFrom = idx + needle.length
  }

  return matches
}
