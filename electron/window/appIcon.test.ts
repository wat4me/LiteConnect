import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, expect, it } from 'vitest'
import { resolveAppIcon, windowAppId } from './appIcon'

const directories: string[] = []
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }) })
it('resolves the Windows dev ICO from the app root independently of Vite URL and cwd', () => {
  const root = mkdtempSync(join(tmpdir(), 'liteconnect-icon-')); directories.push(root)
  mkdirSync(join(root, 'build'))
  writeFileSync(join(root, 'build', 'LiteConnect.ico'), 'icon')
  expect(resolveAppIcon(root, '/unused', false, 'win32')).toBe(join(root, 'build', 'LiteConnect.ico'))
  expect(windowAppId(false)).not.toBe(windowAppId(true))
})
it('uses packaged resources and supports the actual lowercase public filename as fallback', () => {
  const root = mkdtempSync(join(tmpdir(), 'liteconnect-icon-')); directories.push(root)
  mkdirSync(join(root, 'public')); mkdirSync(join(root, 'resources'))
  writeFileSync(join(root, 'public', 'liteConnect.png'), 'png')
  writeFileSync(join(root, 'resources', 'LiteConnect.ico'), 'ico')
  expect(resolveAppIcon(root, join(root, 'resources'), true, 'win32')).toBe(join(root, 'resources', 'LiteConnect.ico'))
  expect(resolveAppIcon(root, '/unused', false, 'linux')?.toLowerCase()).toBe(join(root, 'public', 'liteConnect.png').toLowerCase())
})
