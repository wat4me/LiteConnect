import { describe, expect, it } from 'vitest'
import { aiToolSchemaTokens, measureAiContextPressure, resolveAiContextBudget } from './aiContextPressure'
import { estimateSidebarAiRequest, sshToolsForChat, sshToolSystemAddendum } from './aiSidebarPrompt'
import { parseAiModel } from './aiContext'
import { withAiToolPermissionPrompt } from './aiToolPolicy'

describe('shared AI context pressure', () => {
  it('prices the same SSH context and tool schema in the sidebar and runtime', () => {
    const messages = [{ role: 'user' as const, content: '检查磁盘' }]
    const config = { model: 'test', contextWindowTokens: 32000, maxOutputTokens: 6000, compactionRetainTokens: 4000 }
    const sidebar = estimateSidebarAiRequest({ ...config, systemPrompt: 'sys', sessionId: 'session', cwd: '/srv', messages })
    const runtime = measureAiContextPressure({ ...config, systemPrompt: 'sys', messages,
      extraSystem: withAiToolPermissionPrompt(sshToolSystemAddendum({ sessionId: 'session', cwd: '/srv' }), 'ask'),
      toolSchemaTokens: aiToolSchemaTokens(sshToolsForChat()),
    })
    expect(sidebar.pressure).toEqual(runtime)
    expect(sidebar.totalTokens).toBeLessThanOrEqual(runtime.inputBudgetTokens)
  })

  it('changes the trigger with model output reservations and bounds extreme settings', () => {
    const normal = resolveAiContextBudget({ contextWindowTokens: 32000 })
    const largeOutput = resolveAiContextBudget({ contextWindowTokens: 32000, maxOutputTokens: 12000 })
    expect(largeOutput.thresholdTokens).toBeLessThan(normal.thresholdTokens)
    expect(largeOutput.outputReserveTokens).toBe(12000)
    for (const contextWindowTokens of [4096, 32000, 300000, 4000000]) {
      const budget = resolveAiContextBudget({ contextWindowTokens, maxOutputTokens: 4000000, compactionRetainTokens: 4000000 })
      expect(budget.inputBudgetTokens).toBeGreaterThanOrEqual(512)
      expect(budget.retainTokens).toBeGreaterThan(0)
      expect(budget.retainTokens).toBeLessThan(budget.thresholdTokens)
      expect(budget.thresholdTokens).toBeLessThan(budget.inputBudgetTokens)
    }
  })

  it('derives the automatic output reservation from the catalog, the default and the window', () => {
    // An unknown model falls back to the default ceiling, which a 300k window does not lower.
    expect(resolveAiContextBudget({ contextWindowTokens: 300_000 }).outputReserveTokens).toBe(32_000)
    expect(resolveAiContextBudget({ model: 'unknown-model', contextWindowTokens: 300_000 }).outputReserveTokens).toBe(32_000)
    // A catalog output limit below the default is used as is.
    expect(resolveAiContextBudget({ model: 'openai/gpt-4o', contextWindowTokens: 128_000 }).outputReserveTokens).toBe(16_384)
    // A large advertised limit does not raise the reservation past the default.
    expect(resolveAiContextBudget({ model: 'deepseek/deepseek-chat', contextWindowTokens: 1_000_000 }).outputReserveTokens).toBe(32_000)
    // Small windows still keep most of their capacity for input.
    expect(resolveAiContextBudget({ model: 'deepseek/deepseek-chat', contextWindowTokens: 32_000 }).outputReserveTokens).toBe(6_400)
    // A manual value wins over both.
    expect(resolveAiContextBudget({ model: 'openai/gpt-4o', contextWindowTokens: 128_000, maxOutputTokens: 40_000 }).outputReserveTokens).toBe(40_000)
  })

  it('retains valid per-model budgets through settings normalization', () => {
    expect(parseAiModel({ id: 'm', maxOutputTokens: 8192, compactionRetainTokens: 12000 })).toMatchObject({ maxOutputTokens: 8192, compactionRetainTokens: 12000 })
    expect(parseAiModel({ id: 'm', maxOutputTokens: -1, compactionRetainTokens: Infinity })).toEqual({ id: 'm' })
  })
})
