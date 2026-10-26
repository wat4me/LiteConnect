import { i18n } from '@/i18n'
import {
  AI_DEFAULT_SYSTEM_PROMPT_ZH,
  defaultAiSystemPromptForLocale,
  isBuiltinAiSystemPrompt,
} from '@shared/aiDefaultSystemPrompt'

export { isBuiltinAiSystemPrompt }

/** Built-in prompt for the current interface language. */
export function currentDefaultSystemPrompt(): string {
  return defaultAiSystemPromptForLocale(i18n.global.locale.value)
}

/** @deprecated Prefer currentDefaultSystemPrompt() so the language can change. */
export const DEFAULT_SYSTEM_PROMPT = AI_DEFAULT_SYSTEM_PROMPT_ZH
