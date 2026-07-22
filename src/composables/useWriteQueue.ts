export function useWriteQueue() {
  const CHUNK_SIZE = 4096
  const CHUNK_DELAY_MS = 5
  let writeQueue = ''
  let writeTimer: ReturnType<typeof setTimeout> | null = null

  function processWriteQueue(sessionId: string) {
    if (writeQueue.length === 0) {
      writeTimer = null
      return
    }
    const chunk = writeQueue.substring(0, CHUNK_SIZE)
    writeQueue = writeQueue.substring(CHUNK_SIZE)
    window.LiteConnect.sshWrite(sessionId, chunk)

    if (writeQueue.length > 0) {
      writeTimer = setTimeout(() => processWriteQueue(sessionId), CHUNK_DELAY_MS)
    } else {
      writeTimer = null
    }
  }

  function enqueueWrite(data: string, sessionId: string) {
    writeQueue += data
    if (!writeTimer) {
      processWriteQueue(sessionId)
    }
  }

  function clearWriteQueue() {
    writeQueue = ''
    if (writeTimer) {
      clearTimeout(writeTimer)
      writeTimer = null
    }
  }

  function getWriteQueueLength() {
    return writeQueue.length
  }

  return {
    processWriteQueue,
    enqueueWrite,
    clearWriteQueue,
    getWriteQueueLength,
  }
}