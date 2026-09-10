import { describe, expect, it } from 'vitest'
import {
  buildEditFileDiffPreview,
  buildFileChangeDiffPreview,
  buildWriteFileDiffPreview,
} from './toolDiffPreview'

/** Fake runtime whose read_file returns `content` (or throws when `null`). */
function fakeRuntime(content: string | null, eof = true) {
  return {
    call: async (name: string, args: any) => {
      if (name !== 'read_file') throw new Error(`unexpected tool ${name}`)
      void args
      if (content === null) throw new Error('no such file')
      return { isError: false, structuredContent: { content, eof } }
    },
  }
}

describe('buildWriteFileDiffPreview', () => {
  it('summarizes an in-place edit with added/removed counts', async () => {
    const preview = await buildWriteFileDiffPreview(fakeRuntime('a\nb\nc\n'), {
      sessionId: 's1',
      path: '/etc/app.conf',
      content: 'a\nB\nc\n',
    })
    expect(preview?.summary).toContain('-1')
    expect(preview?.summary).toContain('+1')
    expect(preview?.diff).toContain('--- a//etc/app.conf')
    expect(preview?.diff).toContain('-b')
    expect(preview?.diff).toContain('+B')
  })

  it('does not assume a failed read means a new file', async () => {
    const preview = await buildWriteFileDiffPreview(fakeRuntime(null), {
      sessionId: 's1',
      path: '/tmp/new.txt',
      content: 'hello\n',
    })
    expect(preview?.summary).toContain('无法读取原文件')
    expect(preview?.diff).toBe('')
  })

  it('returns no preview when the content is unchanged', async () => {
    const preview = await buildWriteFileDiffPreview(fakeRuntime('same\n'), {
      sessionId: 's1',
      path: '/tmp/same.txt',
      content: 'same\n',
    })
    expect(preview).toBeUndefined()
  })

  it('skips base64 payloads and missing arguments', async () => {
    expect(
      await buildWriteFileDiffPreview(fakeRuntime('x'), {
        sessionId: 's1',
        path: '/tmp/x',
        content: 'AAAA',
        encoding: 'base64',
      }),
    ).toBeUndefined()
    expect(await buildWriteFileDiffPreview(fakeRuntime('x'), { path: '/tmp/x' })).toBeUndefined()
  })

  it('returns no preview without a runtime', async () => {
    expect(
      await buildWriteFileDiffPreview(undefined, {
        sessionId: 's1',
        path: '/tmp/x',
        content: 'y',
      }),
    ).toBeUndefined()
  })
})

describe('buildEditFileDiffPreview', () => {
  const file = [...Array.from({ length: 30 }, (_, i) => `line ${i + 1}`), 'listen 80;'].join('\n')

  it('shows a small focused diff instead of the whole file', async () => {
    const preview = await buildEditFileDiffPreview(fakeRuntime(`${file}\n`), {
      sessionId: 's1',
      path: '/etc/nginx.conf',
      oldString: 'listen 80;',
      newString: 'listen 8080;',
    })
    expect(preview?.diff).toContain('-listen 80;')
    expect(preview?.diff).toContain('+listen 8080;')
    // Only the change plus 2 context lines either side — never the whole file.
    expect(preview!.diff.split('\n').length).toBeLessThan(12)
    expect(preview!.diff).not.toContain('line 1\n')
  })

  it('predicts an ambiguous match on the card', async () => {
    const preview = await buildEditFileDiffPreview(fakeRuntime('listen 80;\nlisten 80;\n'), {
      sessionId: 's1',
      path: '/etc/nginx.conf',
      oldString: 'listen 80;',
      newString: 'listen 8080;',
    })
    expect(preview?.summary).toContain('多次')
    expect(preview?.summary).toContain('2 处')
    expect(preview?.diff).toBe('')
  })

  it('predicts a missing match on the card', async () => {
    const preview = await buildEditFileDiffPreview(fakeRuntime('a\nb\n'), {
      sessionId: 's1',
      path: '/etc/nginx.conf',
      oldString: 'nope',
      newString: 'x',
    })
    expect(preview?.summary).toContain('找不到')
  })

  it('never claims a failure when the read was truncated', async () => {
    const preview = await buildEditFileDiffPreview(fakeRuntime('a\nb\n', false), {
      sessionId: 's1',
      path: '/var/log/app.log',
      oldString: 'much later in the file',
      newString: 'x',
    })
    expect(preview).toBeUndefined()
  })

  it('applies replaceAll when asked', async () => {
    const preview = await buildEditFileDiffPreview(fakeRuntime('k=1\nk=1\n'), {
      sessionId: 's1',
      path: '/etc/app.conf',
      oldString: 'k=1',
      newString: 'k=2',
      replaceAll: true,
    })
    expect(preview?.summary).toContain('+2')
    expect(preview?.summary).toContain('-2')
  })

  it('returns nothing without a runtime, target, or oldString', async () => {
    expect(
      await buildEditFileDiffPreview(undefined, { sessionId: 's1', path: '/x', oldString: 'a', newString: 'b' }),
    ).toBeUndefined()
    expect(await buildEditFileDiffPreview(fakeRuntime('x'), { path: '/x', oldString: 'a', newString: 'b' })).toBeUndefined()
    expect(
      await buildEditFileDiffPreview(fakeRuntime('x'), { sessionId: 's1', path: '/x', newString: 'b' }),
    ).toBeUndefined()
  })
})

describe('buildFileChangeDiffPreview', () => {
  it('routes each rewriting tool to its own builder', async () => {
    const write = await buildFileChangeDiffPreview(fakeRuntime('a\n'), 'write_file', {
      sessionId: 's1',
      path: '/tmp/x',
      content: 'b\n',
    })
    expect(write?.diff).toContain('+b')

    const edit = await buildFileChangeDiffPreview(fakeRuntime('a\nb\n'), 'edit_file', {
      sessionId: 's1',
      path: '/tmp/x',
      oldString: 'a',
      newString: 'z',
    })
    expect(edit?.diff).toContain('+z')

    expect(
      await buildFileChangeDiffPreview(fakeRuntime('a\n'), 'grep', { sessionId: 's1', path: '/tmp/x' }),
    ).toBeUndefined()
  })
})

it.each(['prefix\n', 'different\n'])('warns before overwriting an incompletely read file (%s)', async content => {
  const preview = await buildWriteFileDiffPreview(fakeRuntime('prefix\n', false), { sessionId: 's', path: '/tmp/a', content })
  expect(preview?.summary).toContain('覆盖整个文件')
  expect(preview?.diff).toBe('')
})
