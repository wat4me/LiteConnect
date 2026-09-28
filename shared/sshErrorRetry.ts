/** Errors requiring trust or authentication changes should not be retried unattended. */
export function isNonRetryableSshError(message: string | undefined | null): boolean {
  const lower = (message || '').toLowerCase()
  return (
    lower.includes('host key') ||
    lower.includes('hostkey') ||
    lower.includes('authentication') ||
    lower.includes('permission denied') ||
    lower.includes('all configured authentication methods failed') ||
    lower.includes('no more auth methods')
  )
}
