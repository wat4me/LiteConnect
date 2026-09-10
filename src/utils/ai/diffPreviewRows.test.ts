import { describe, expect, it } from 'vitest'
import { diffPreviewRows } from './diffPreviewRows'

describe('diffPreviewRows', () => {
  it('classifies headers, hunks, adds, deletes and context', () => {
    const rows = diffPreviewRows(
      ['--- a/app.conf', '+++ b/app.conf', '@@ -1,3 +1,3 @@', ' keep', '-old', '+new'].join('\n'),
    )
    expect(rows.map((r) => r.kind)).toEqual(['head', 'head', 'hunk', 'ctx', 'del', 'add'])
  })

  it('keeps the leading space so context lines stay aligned', () => {
    const rows = diffPreviewRows(' keep')
    expect(rows[0].text).toBe(' keep')
  })

  it('treats a header-looking line inside a hunk as a delete', () => {
    const rows = diffPreviewRows(['@@ -1,1 +1,1 @@', '--- not a header'].join('\n'))
    expect(rows[1].kind).toBe('del')
  })

  it('returns nothing for empty input', () => {
    expect(diffPreviewRows(undefined)).toEqual([])
    expect(diffPreviewRows('')).toEqual([])
  })

  it('normalizes CRLF', () => {
    expect(diffPreviewRows('+a\r\n+b').map((r) => r.text)).toEqual(['+a', '+b'])
  })
})
