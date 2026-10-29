import { afterEach, beforeEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import type { SettingsIpcCtx } from './ctx'
import { putWallpaperPick } from './wallpaper'
import { commitSettings } from './commitSettings'

let root: string, dir: string, ctx: SettingsIpcCtx
let current: { appBackground: { fileName: string; imageUrl: string; fit: string; overlay: number } }
let fail: boolean
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'liteconnect-wallpaper-test-'))
  dir = join(root, 'background'); await mkdir(dir)
  await writeFile(join(dir, 'wallpaper.png'), 'old image')
  current = { appBackground: { fileName: 'wallpaper.png', imageUrl: 'old-url', fit: 'cover', overlay: 55 } }
  fail = false
  ctx = { settingsStore: {
    getAppBackgroundDir: () => dir, getAppBackground: () => current.appBackground,
    getAll: () => structuredClone(current),
    applyMany: async (patch: { appBackground: object }) => {
      if (fail) throw new Error('commit failed')
      current.appBackground = { ...current.appBackground, ...patch.appBackground }
      return structuredClone(current)
    },
  } } as unknown as SettingsIpcCtx
})
afterEach(async () => {
  expect(resolve(root).startsWith(resolve(tmpdir()) + sep) && basename(root).startsWith('liteconnect-wallpaper-test-')).toBe(true)
  await rm(root, { recursive: true, force: true })
})

it('keeps the old image and a reusable pick token after a failed configuration commit', async () => {
  const source = join(root, 'picked.png'); await writeFile(source, 'new image')
  const token = putWallpaperPick(source)
  fail = true
  await expect(commitSettings(ctx, { appBackground: { token } })).rejects.toThrow('commit failed')
  expect(await readdir(dir)).toEqual(['wallpaper.png'])
  expect(await readFile(join(dir, current.appBackground.fileName), 'utf8')).toBe('old image')
  fail = false
  await commitSettings(ctx, { appBackground: { token } })
  expect(current.appBackground.fileName).toMatch(/^wallpaper-[a-f0-9]{32}\.png$/)
  expect(await readFile(join(dir, current.appBackground.fileName), 'utf8')).toBe('new image')
  expect(await readdir(dir)).toEqual([current.appBackground.fileName])
  await expect(commitSettings(ctx, { appBackground: { token } })).rejects.toThrow()
})

it('does not consume the selection or remove the old image when reading the picked file fails', async () => {
  const source = join(root, 'picked.png'); await writeFile(source, 'new image')
  const token = putWallpaperPick(source); await unlink(source)
  await expect(commitSettings(ctx, { appBackground: { token } })).rejects.toThrow()
  expect(await readFile(join(dir, 'wallpaper.png'), 'utf8')).toBe('old image')
  await writeFile(source, 'retry image')
  await commitSettings(ctx, { appBackground: { token } })
  expect(await readFile(join(dir, current.appBackground.fileName), 'utf8')).toBe('retry image')
})

it('clears the old image only after the configuration is committed', async () => {
  fail = true
  await expect(commitSettings(ctx, { appBackground: { clear: true } })).rejects.toThrow()
  expect(await readdir(dir)).toEqual(['wallpaper.png'])
  expect(current.appBackground.fileName).toBe('wallpaper.png')
  fail = false
  await commitSettings(ctx, { appBackground: { clear: true } })
  expect(current.appBackground.fileName).toBe('')
  expect(await readdir(dir)).toEqual([])
})

it('keeps the committed image intact when two windows replace the same file type concurrently', async () => {
  const first = join(root, 'first.png'), second = join(root, 'second.png')
  await writeFile(first, 'first'); await writeFile(second, 'second')
  await Promise.all([
    commitSettings(ctx, { appBackground: { token: putWallpaperPick(first) } }),
    commitSettings(ctx, { appBackground: { token: putWallpaperPick(second) } }),
  ])
  expect(['first', 'second']).toContain(await readFile(join(dir, current.appBackground.fileName), 'utf8'))
  expect(await readdir(dir)).toEqual([current.appBackground.fileName])
})
