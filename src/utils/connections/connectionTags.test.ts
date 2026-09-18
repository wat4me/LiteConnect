import { describe, expect, it } from 'vitest'
import {
  getConnectionTagColor,
  getConnectionTagLabel,
  hasConnectionColorTag,
  CONNECTION_COLOR_TAGS,
} from '@/utils/connections/connectionTags'

describe('connectionTags', () => {
  it('has none + color options', () => {
    expect(CONNECTION_COLOR_TAGS.length).toBeGreaterThan(3)
    expect(CONNECTION_COLOR_TAGS[0].id).toBe('')
  })

  it('resolves known tag colors', () => {
    expect(getConnectionTagColor('red')).toBe('#f85149')
    expect(getConnectionTagColor('blue')).toBe('#58a6ff')
  })

  it('unknown / empty → default gray', () => {
    expect(getConnectionTagColor('')).toBe('#8b949e')
    expect(getConnectionTagColor(undefined)).toBe('#8b949e')
    expect(getConnectionTagColor('nope')).toBe('#8b949e')
  })

  it('resolves tag labels', () => {
    expect(getConnectionTagLabel('purple')).toBeTruthy()
    expect(getConnectionTagLabel('')).toBeTruthy()
    expect(getConnectionTagLabel(undefined)).toBe(getConnectionTagLabel(''))
  })

  it('detects non-default color tags', () => {
    expect(hasConnectionColorTag('purple')).toBe(true)
    expect(hasConnectionColorTag('gray')).toBe(true)
    expect(hasConnectionColorTag('')).toBe(false)
    expect(hasConnectionColorTag(undefined)).toBe(false)
    expect(hasConnectionColorTag('nope')).toBe(false)
  })
})
