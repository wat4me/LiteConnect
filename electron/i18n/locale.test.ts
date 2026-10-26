import { afterEach, describe, expect, it } from 'vitest'
import { getMainLocale, setMainLocale, t } from './index'
import { resolveStoredAiSystemPrompt } from '../utils/constants'
import {
  AI_DEFAULT_SYSTEM_PROMPT_EN,
  AI_DEFAULT_SYSTEM_PROMPT_ZH,
} from '../../shared/aiDefaultSystemPrompt'

describe('main-process locale', () => {
  afterEach(() => setMainLocale('zh-CN'))

  it('translates with the selected catalog and falls back from an unknown locale', () => {
    setMainLocale('en-US')
    expect(getMainLocale()).toBe('en-US')
    expect(t('tray.showWindow')).toBe('Show main window')
    expect(t('x11.autoStarted', { host: '127.0.0.1', port: 6000 })).toContain('127.0.0.1:6000')
    setMainLocale('fr-FR')
    expect(getMainLocale()).toBe('zh-CN')
    expect(t('tray.quit')).toBe('退出 LiteConnect')
  })

  it('replaces a stored built-in prompt for the current language and keeps a custom one', () => {
    setMainLocale('en-US')
    expect(resolveStoredAiSystemPrompt(AI_DEFAULT_SYSTEM_PROMPT_ZH)).toBe(AI_DEFAULT_SYSTEM_PROMPT_EN)
    expect(resolveStoredAiSystemPrompt('请始终用中文回答。')).toBe('请始终用中文回答。')
    setMainLocale('zh-CN')
    expect(resolveStoredAiSystemPrompt(AI_DEFAULT_SYSTEM_PROMPT_EN)).toBe(AI_DEFAULT_SYSTEM_PROMPT_ZH)
    expect(resolveStoredAiSystemPrompt('')).toBe('')
  })
})
