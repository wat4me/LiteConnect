import { describe, expect, it } from 'vitest'
import { applyDbSettingsToElement, getCachedDbSettings } from './useDbSettings'

function fakeEl() {
  const props: Record<string, string> = {}
  return {
    style: {
      setProperty(k: string, v: string) {
        props[k] = v
      },
      getPropertyValue(k: string) {
        return props[k] ?? ''
      },
    },
  }
}

describe('applyDbSettingsToElement', () => {
  it('writes editor tokens and does not leak size into --font-ui chrome', () => {
    const el = fakeEl()
    applyDbSettingsToElement(el as unknown as HTMLElement, {
      ...getCachedDbSettings(),
      fontFamily: '"Fira Code", monospace',
      fontSize: 20,
    })
    expect(el.style.getPropertyValue('--db-font-size')).toBe('20px')
    expect(el.style.getPropertyValue('--db-font-family')).toContain('Fira Code')
    expect(el.style.getPropertyValue('--font-mono')).toContain('Fira Code')
    expect(el.style.getPropertyValue('--font-ui')).toBe('')
    expect(el.style.getPropertyValue('--font-ui-sm')).toBe('')
  })
})
