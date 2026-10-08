import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/i18n', () => ({ t: (key: string) => key }))

let variables: Map<string, string>
let attributes: Map<string, string>
let storage: Map<string, string>
let updateTitleBar: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  variables = new Map()
  attributes = new Map()
  storage = new Map()
  updateTitleBar = vi.fn()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
  })
  vi.stubGlobal('document', { createElement: () => ({}), documentElement: {
    setAttribute: (key: string, value: string) => attributes.set(key, value),
    style: {
      setProperty: (key: string, value: string) => variables.set(key, value),
      removeProperty: (key: string) => variables.delete(key),
    },
  } })
  vi.stubGlobal('window', { LiteConnect: { updateTitleBar } })
})

afterEach(() => vi.unstubAllGlobals())

describe('theme highlights and preset compatibility', () => {
  it.each([
    { bgColor: '#15101b', fontColor: '#f2e9ff', accentStrength: 10, selectionStrength: 30 },
    { bgColor: '#fff4dc', fontColor: '#372a16', accentStrength: 8, selectionStrength: 20 },
    { bgColor: '#163b2e', fontColor: '#e3ffee', accentStrength: 10, selectionStrength: 30 },
  ])('links highlights to the active accent on custom background $bgColor', async colors => {
    const { useTheme, getTerminalColors } = await import('./useTheme')
    const theme = useTheme()
    theme.setCustomColors({ fontColor: colors.fontColor, bgColor: colors.bgColor })
    theme.setTheme('custom')
    expect(variables.get('--bg-primary')).toBe(colors.bgColor)
    expect(variables.get('--text-primary')).toBe(colors.fontColor)
    expect(variables.get('--accent-bg')).toBe(`color-mix(in srgb, var(--accent) ${colors.accentStrength}%, transparent)`)
    expect(variables.get('--selection-bg')).toBe(`color-mix(in srgb, var(--accent) ${colors.selectionStrength}%, transparent)`)
    // A runtime accent override remains authoritative: derived values retain the
    // reference instead of an RGB snapshot captured when the theme was applied.
    variables.set('--accent', '#cb42a4')
    expect(variables.get('--accent-bg')).toContain('var(--accent)')
    expect(variables.get('--selection-bg')).toContain('var(--accent)')
    expect(getTerminalColors('custom', theme.customColors.value)).toMatchObject({
      background: colors.bgColor, foreground: colors.fontColor,
    })
    expect(updateTitleBar).toHaveBeenLastCalledWith('custom', expect.objectContaining({ color: colors.bgColor }))
  })

  it.each(['dark', 'light', 'eyecare'] as const)('clears all custom inline tokens before switching to %s', async preset => {
    const { useTheme } = await import('./useTheme')
    const theme = useTheme()
    const colors = { fontColor: '#362020', bgColor: '#fff0e1' }
    theme.setCustomColors(colors)
    theme.setTheme('custom')
    expect(variables.size).toBeGreaterThan(0)
    theme.setTheme(preset)
    expect(variables.size).toBe(0)
    expect(attributes.get('data-theme')).toBe(preset)
    expect(storage.get('liteconnect-theme')).toBe(preset)
    expect(updateTitleBar).toHaveBeenLastCalledWith(preset)
    theme.setTheme('custom')
    expect(theme.customColors.value).toEqual(colors)
    expect(variables.get('--bg-primary')).toBe(colors.bgColor)
    expect(variables.get('--accent-bg')).toContain('var(--accent)')
  })

  it('recalculates highlight strengths when custom colors cross dark and light modes', async () => {
    const { useTheme } = await import('./useTheme')
    const theme = useTheme()
    theme.setTheme('custom')
    expect(variables.get('--selection-bg')).toContain('30%')
    theme.setCustomColors({ fontColor: '#222222', bgColor: '#ffffff' })
    expect(variables.get('--selection-bg')).toContain('20%')
    expect(variables.get('--accent-bg')).toContain('8%')
    expect(variables.get('--text-primary')).toBe('#222222')
    expect(JSON.parse(storage.get('liteconnect-custom-colors')!)).toEqual(theme.customColors.value)
  })

  it('restores persisted custom colors and live accent-derived highlights at startup', async () => {
    storage.set('liteconnect-theme', 'custom')
    storage.set('liteconnect-custom-colors', JSON.stringify({ fontColor: '#efe9fc', bgColor: '#241633' }))
    const { useTheme } = await import('./useTheme')
    expect(useTheme().theme.value).toBe('custom')
    expect(variables.get('--bg-primary')).toBe('#241633')
    expect(variables.get('--accent-bg')).toContain('var(--accent)')
    expect(variables.get('--selection-bg')).toContain('var(--accent)')
  })
})
