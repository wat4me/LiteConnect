import { describe, expect, it } from 'vitest'
import { createSharedTranslator } from './index'
import { normalizeAiImages, assertAiImageCapability, validateAiRequestImages } from '../aiImages'
import { validateAiNotification } from '../aiNotifications'
import { validateAiSchedule } from '../aiSchedules'
import { assessAiToolCall, AI_TOOL_EXPLANATION_DESCRIPTION } from '../aiToolPolicy'
import { buildUnifiedDiff, formatToolDiffSummary } from '../aiToolDiff'
import type { AiImageAttachment } from '../types/ai'
import { formatToolRunDisplay } from '../aiToolRunDisplay'

const en = createSharedTranslator('en-US')
const zh = createSharedTranslator('zh-CN')

describe('shared localized validation', () => {
  it('translates optional tool group labels without changing machine-facing group names', () => {
    const args = JSON.stringify({ groups: ['file_transfer', 'interactive_terminal'] })
    const view = formatToolRunDisplay({ name: 'load_tools', args, content: '{}' }, en)
    expect(view.hint).toBe('File transfers, Interactive terminal')
    expect(args).toContain('file_transfer')
  })
  it('uses injected image errors and preserves literal interpolation values', () => {
    expect(() => normalizeAiImages([{}], en)).toThrow(en('sharedText.imageAttachmentInvalid'))
    expect(() => normalizeAiImages([{}], zh)).toThrow(zh('sharedText.imageAttachmentInvalid'))
    const image = { name: '用户-image@host.png', missing: true } as AiImageAttachment
    expect(() => assertAiImageCapability([{ role: 'user', content: '', images: [image] }], false, en)).toThrow(en('sharedText.imageUnsupported'))
    expect(() => validateAiRequestImages([{ role: 'user', content: '', images: [image] }], en)).toThrow('用户-image@host.png is missing')
  })

  it('localizes notification and schedule errors without changing the validation rules', () => {
    const notification = { enabled: true, url: 'not a URL', mode: 'all' as const }
    expect(() => validateAiNotification(notification, en)).toThrow(en('sharedText.notificationUrlRequired'))
    expect(() => validateAiNotification({ ...notification, url: 'https://example.com/hook' }, en)).not.toThrow()
    const plan = { name: 'inspect', connectionId: 'one', prompt: 'check', intervalMinutes: 60, enabled: true }
    expect(() => validateAiSchedule({ ...plan, connectionIds: [] }, en)).toThrow(en('sharedText.scheduleHostsInvalid'))
    expect(validateAiSchedule(plan, en)).toEqual(validateAiSchedule(plan, zh))
  })

  it('keeps permission decisions identical across languages and localizes missing declarations', () => {
    const args = { risk: 'write', explanation: 'Restart app' }
    for (const mode of ['ask', 'auto', 'readonly'] as const) {
      expect(assessAiToolCall('exec', args, mode, en)).toEqual(assessAiToolCall('exec', args, mode, zh))
    }
    expect(assessAiToolCall('exec', {}, 'ask', en)).toMatchObject({ action: 'reclassify', code: 'RISK_REQUIRED', reason: en('sharedText.riskRequired') })
    expect(AI_TOOL_EXPLANATION_DESCRIPTION).not.toContain('Chinese')
  })

  it('formats diff summaries in the injected language while preserving raw diffs', () => {
    const diff = buildUnifiedDiff('', 'hello\n', { created: true })
    expect(formatToolDiffSummary(diff, en)).toBe(`New file, +${diff.added} lines`)
    expect(formatToolDiffSummary(diff, zh)).toBe(`新文件，+${diff.added} 行`)
    expect(diff.diff).toContain('+hello')
  })
})
