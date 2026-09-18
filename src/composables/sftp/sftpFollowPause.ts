/**
 * Session-level "pause SFTP follow" flags.
 * Survives FileSidebar unmount so docker-exec while the panel is closed still applies.
 */
const pausedByContainer = new Set<string>()

export function markSftpFollowPausedByContainer(sessionId: string): void {
  if (sessionId) pausedByContainer.add(sessionId)
}

export function clearSftpFollowPausedByContainer(sessionId: string): void {
  pausedByContainer.delete(sessionId)
}

export function isSftpFollowPausedByContainer(sessionId: string): boolean {
  return pausedByContainer.has(sessionId)
}
