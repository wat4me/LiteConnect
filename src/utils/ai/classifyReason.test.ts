import { describe, expect, it } from 'vitest'
import { formatClassifyReason } from './classifyReason'

const t = (key: string, params?: Record<string, unknown>) =>
  params?.binary ? `${key}:${params.binary}` : key

describe('formatClassifyReason', () => {
  it('maps the unlisted-command reason', () => {
    expect(formatClassifyReason('unlisted command treated as safe mutation', t)).toBe('ai.classifyUnlistedSafe')
  })

  it('interpolates binary names', () => {
    expect(formatClassifyReason('non-destructive mutation (mkdir)', t)).toBe('ai.classifySafeBinary:mkdir')
    expect(formatClassifyReason('privileged wrapper (sudo)', t)).toBe('ai.classifyPrivileged:sudo')
  })

  it('passes unknown text through', () => {
    expect(formatClassifyReason('something custom', t)).toBe('something custom')
  })
})
