import { describe, expect, it } from 'vitest'
import {
  buildUnifiedDiff,
  formatToolDiffSummary,
  splitDiffLines,
  type ToolDiffPreview,
} from './aiToolDiff'

const OLD = ['server {', '  listen 80;', '  root /var/www;', '  index a.html;', '}'].join('\n')
const NEW = ['server {', '  listen 443;', '  root /srv/www;', '  index a.html;', '}'].join('\n')

describe('buildUnifiedDiff', () => {
  it('reports no change for identical content', () => {
    const preview = buildUnifiedDiff(OLD, OLD)
    expect(preview.diff).toBe('')
    expect(preview.added).toBe(0)
    expect(preview.removed).toBe(0)
    expect(formatToolDiffSummary(preview)).toBe('内容无变化')
  })

  it('emits a unified hunk with +/- counts', () => {
    const preview = buildUnifiedDiff(OLD, NEW, { path: '/etc/nginx/site.conf' })
    expect(preview.added).toBe(2)
    expect(preview.removed).toBe(2)
    expect(preview.diff).toContain('--- a//etc/nginx/site.conf')
    expect(preview.diff).toContain('+++ b//etc/nginx/site.conf')
    expect(preview.diff).toContain('@@ ')
    expect(preview.diff).toContain('-  listen 80;')
    expect(preview.diff).toContain('+  listen 443;')
    expect(preview.diff).toContain('   index a.html;')
    expect(formatToolDiffSummary(preview)).toBe('+2 行 / -2 行')
  })

  it('marks a missing target as a new file', () => {
    const preview = buildUnifiedDiff('', NEW, { path: '/tmp/new.conf', created: true })
    expect(preview.created).toBe(true)
    expect(preview.removed).toBe(0)
    expect(preview.added).toBe(5)
    expect(formatToolDiffSummary(preview)).toBe('新文件，+5 行')
    expect(preview.diff.split('\n').every((row) => row.startsWith('+') || row.startsWith('---') || row.startsWith('+++') || row.startsWith('@@'))).toBe(true)
  })

  it('keeps context around a single-line edit in a long file', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`)
    const changed = lines.slice()
    changed[100] = 'line 101 EDITED'
    const preview = buildUnifiedDiff(lines.join('\n'), changed.join('\n'))
    expect(preview.added).toBe(1)
    expect(preview.removed).toBe(1)
    // Only the changed neighbourhood is rendered, not all 200 lines.
    expect(preview.diff.split('\n').length).toBeLessThan(40)
    expect(preview.diff).toContain('+line 101 EDITED')
    expect(preview.diff).toContain(' line 100')
    expect(preview.diff).toContain(' line 102')
  })

  it('clips runaway content and flags truncation', () => {
    const before = Array.from({ length: 400 }, (_, i) => `old ${i}`).join('\n')
    const after = Array.from({ length: 400 }, (_, i) => `new ${i}`).join('\n')
    const preview = buildUnifiedDiff(before, after)
    expect(preview.truncated).toBe(true)
    expect(preview.diff.length).toBeLessThanOrEqual(6_001)
  })

  it('tolerates empty and CRLF input', () => {
    expect(splitDiffLines('')).toEqual([])
    expect(splitDiffLines('a\r\nb\r\n')).toEqual(['a', 'b'])
    const preview: ToolDiffPreview = buildUnifiedDiff('', '')
    expect(preview.diff).toBe('')
  })
})
