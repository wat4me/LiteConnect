// Electron IPC preserves Error.message, but drops custom Error properties.
export const SSH_HOST_KEY_CONFIRMATION_REQUIRED = '[SSH_HOST_KEY_CONFIRMATION_REQUIRED] Host key confirmation required'

export function isSshHostKeyConfirmationRequired(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return message.includes(SSH_HOST_KEY_CONFIRMATION_REQUIRED)
}
