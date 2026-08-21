import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeFileAtomic, writeJsonAtomic } from './atomicWrite'

describe('atomicWrite', () => {
  let dir = ''

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
    dir = ''
  })

  it('writes a new file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'lc-atomic-'))
    const target = join(dir, 'a.json')
    await writeFileAtomic(target, 'hello')
    expect(await readFile(target, 'utf-8')).toBe('hello')
  })

  it('overwrites an existing file', async () => {
    dir = await mkdtemp(join(tmpdir(), 'lc-atomic-'))
    const target = join(dir, 'a.json')
    await writeFile(target, 'old')
    await writeJsonAtomic(target, { ok: true })
    const parsed = JSON.parse(await readFile(target, 'utf-8'))
    expect(parsed).toEqual({ ok: true })
  })

  it('does not leave a .tmp next to a successful write', async () => {
    dir = await mkdtemp(join(tmpdir(), 'lc-atomic-'))
    const target = join(dir, 'a.json')
    await writeFileAtomic(target, 'x')
    const { readdir } = await import('fs/promises')
    const names = await readdir(dir)
    expect(names.filter((n) => n.endsWith('.tmp'))).toEqual([])
  })
})
