import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import {
  AI_DEFAULT_SYSTEM_PROMPT_EN,
  AI_DEFAULT_SYSTEM_PROMPT_ZH,
  defaultAiSystemPromptForLocale,
  isBuiltinAiSystemPrompt,
} from './aiDefaultSystemPrompt'

describe('built-in AI system prompt', () => {
  it('preserves the exact earlier defaults used to distinguish user edits', () => {
    const hash = (text: string) => createHash('sha256').update(text).digest('hex')
    expect(hash(AI_DEFAULT_SYSTEM_PROMPT_ZH)).toBe('15198e63513596c9b9b77da051dcd382f695f96f9f111b6af2f1424bcd870454')
    expect(hash(AI_DEFAULT_SYSTEM_PROMPT_EN)).toBe('208c964ce5d225757830673e07aaca52641d81f52b8ddb45ea3c7f5fdd3128d7')
  })
  it('follows the interface locale and still yields to a custom prompt', () => {
    expect(defaultAiSystemPromptForLocale('en-US')).toBe(AI_DEFAULT_SYSTEM_PROMPT_EN)
    expect(defaultAiSystemPromptForLocale('zh-CN')).toBe(AI_DEFAULT_SYSTEM_PROMPT_ZH)
    expect(defaultAiSystemPromptForLocale('fr')).toBe(AI_DEFAULT_SYSTEM_PROMPT_ZH)
    expect(AI_DEFAULT_SYSTEM_PROMPT_EN).toContain('Answer in English by default')
    expect(AI_DEFAULT_SYSTEM_PROMPT_ZH).toContain('简体中文')
  })

  it('recognizes only the known built-in texts', () => {
    expect(isBuiltinAiSystemPrompt(AI_DEFAULT_SYSTEM_PROMPT_ZH)).toBe(true)
    expect(isBuiltinAiSystemPrompt(AI_DEFAULT_SYSTEM_PROMPT_EN)).toBe(true)
    expect(isBuiltinAiSystemPrompt('请用中文回答，并先检查磁盘。')).toBe(false)
    expect(isBuiltinAiSystemPrompt(AI_DEFAULT_SYSTEM_PROMPT_ZH + '\n额外要求')).toBe(false)
  })
})
