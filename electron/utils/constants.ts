import { t } from '../i18n'

/** Default AI system prompt (locale-aware; content lives in electron/i18n). */
export function getDefaultAiSystemPrompt(): string {
  return t('ai.defaultSystemPrompt')
}

/** @deprecated Prefer getDefaultAiSystemPrompt() so locale can change. */
export const DEFAULT_AI_SYSTEM_PROMPT = getDefaultAiSystemPrompt()

export const LEGACY_AI_SYSTEM_PROMPT =
  'You are a concise SSH assistant. Help explain commands, errors, Linux operations, and troubleshooting steps.'

/** In-app SFTP editor max file size (bytes). */
export const SFTP_EDITOR_MAX_BYTES = 5 * 1024 * 1024

/** Max clipboard text size written via IPC (chars ≈ bytes for ASCII; UTF-16 may be larger). */
export const CLIPBOARD_MAX_CHARS = 2 * 1024 * 1024

/** Max remote command length for ssh:exec. */
export const SSH_EXEC_MAX_COMMAND_CHARS = 32 * 1024

/** Max payload per ssh:write IPC message. */
export const SSH_WRITE_MAX_CHARS = 1 * 1024 * 1024

/** Max local path length for shell open / show-in-folder. */
export const LOCAL_PATH_MAX_CHARS = 4096

export const SSH_EXEC_MIN_TIMEOUT_MS = 1_000
export const SSH_EXEC_MAX_TIMEOUT_MS = 120_000
export const SSH_EXEC_DEFAULT_TIMEOUT_MS = 30_000
