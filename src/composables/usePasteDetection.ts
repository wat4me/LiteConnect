const BRACKET_PASTE_START = '\x1b[200~'
const BRACKET_PASTE_END = '\x1b[201~'

export function usePasteDetection() {
  let pastingDepth = 0
  let pastingBuffer = ''

  function updatePasteState(data: string) {
    pastingBuffer += data
    while (pastingBuffer.length > 0) {
      const startIdx = pastingBuffer.indexOf(BRACKET_PASTE_START)
      const endIdx = pastingBuffer.indexOf(BRACKET_PASTE_END)
      if (startIdx === -1 && endIdx === -1) {
        pastingBuffer = ''
        break
      }
      if (endIdx !== -1 && (startIdx === -1 || endIdx < startIdx)) {
        pastingDepth = Math.max(0, pastingDepth - 1)
        pastingBuffer = pastingBuffer.substring(endIdx + BRACKET_PASTE_END.length)
      } else {
        pastingDepth++
        pastingBuffer = pastingBuffer.substring(startIdx + BRACKET_PASTE_START.length)
      }
    }
    if (pastingBuffer.length > 20) pastingBuffer = ''
  }

  function isPasting(): boolean {
    return pastingDepth > 0
  }

  function resetPasteState() {
    pastingDepth = 0
    pastingBuffer = ''
  }

  return {
    updatePasteState,
    isPasting,
    resetPasteState,
  }
}