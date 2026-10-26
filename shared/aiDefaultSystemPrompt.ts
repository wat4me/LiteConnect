import { createSharedTranslator } from './i18n'

/** Previous one-line default. Still recognized so it is not treated as a user edit. */
export const LEGACY_AI_SYSTEM_PROMPT =
  'You are a concise SSH assistant. Help explain commands, errors, Linux operations, and troubleshooting steps.'

export const AI_DEFAULT_SYSTEM_PROMPT_ZH = createSharedTranslator('zh-CN')('sharedText.promptDefaultSystem')

export const AI_DEFAULT_SYSTEM_PROMPT_EN = createSharedTranslator('en-US')('sharedText.promptDefaultSystem')

const BUILTIN_AI_SYSTEM_PROMPTS = new Set([
  LEGACY_AI_SYSTEM_PROMPT,
  AI_DEFAULT_SYSTEM_PROMPT_ZH,
  AI_DEFAULT_SYSTEM_PROMPT_EN,
])

/** True only for known built-in defaults, never for a user-edited prompt. */
export function isBuiltinAiSystemPrompt(value: string): boolean {
  return BUILTIN_AI_SYSTEM_PROMPTS.has(value)
}

export function defaultAiSystemPromptForLocale(locale: string): string {
  return locale === 'en-US' ? AI_DEFAULT_SYSTEM_PROMPT_EN : AI_DEFAULT_SYSTEM_PROMPT_ZH
}
