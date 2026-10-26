import { getMainLocale, t } from '../i18n'
import {
  defaultAiSystemPromptForLocale,
  isBuiltinAiSystemPrompt,
  LEGACY_AI_SYSTEM_PROMPT,
} from '../../shared/aiDefaultSystemPrompt'

export { LEGACY_AI_SYSTEM_PROMPT, isBuiltinAiSystemPrompt }

/** Default AI system prompt for the current main-process locale. */
export function getDefaultAiSystemPrompt(): string {
  return defaultAiSystemPromptForLocale(getMainLocale())
}

/**
 * Keep a stored prompt only when it is not one of the known built-in defaults.
 * An empty string is a user choice and is preserved.
 */
export function resolveStoredAiSystemPrompt(stored: unknown): string {
  if (typeof stored === 'string' && !isBuiltinAiSystemPrompt(stored)) return stored
  return getDefaultAiSystemPrompt()
}

/** @deprecated Prefer getDefaultAiSystemPrompt() so locale can change. */
export const DEFAULT_AI_SYSTEM_PROMPT = t('ai.defaultSystemPrompt')

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
