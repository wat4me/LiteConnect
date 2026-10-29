import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { prepareMacSigning } = require('../../scripts/macos-signing.cjs')
const { verifyMacArtifacts } = require('../../scripts/verify-macos-release.cjs')
const projectDir = path.resolve(import.meta.dirname, '../..')
const team = 'ABCDE12345'
const key = '-----BEGIN PRIVATE KEY-----\nTEST-KEY-ONLY\n-----END PRIVATE KEY-----\n'
const credentials = {
  MACOS_SIGNING_ENABLED: 'true', CSC_LINK: 'test-p12-base64', CSC_KEY_PASSWORD: 'test-password',
  APPLE_TEAM_ID: team, APPLE_API_KEY_BASE64: Buffer.from(key).toString('base64'),
  APPLE_API_KEY_ID: 'TESTKEY123', APPLE_API_ISSUER: 'test-issuer',
}
const cleanups: Array<() => void> = []
afterEach(() => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0)) cleanup() })

describe('macOS signing preparation', () => {
  it('keeps unsigned local builds explicit and refuses partial release setup', () => {
    const plan = prepareMacSigning({}, projectDir)
    expect(plan.signed).toBe(false)
    expect(plan.config.mac).toMatchObject({ identity: null, hardenedRuntime: false, notarize: false })
    expect(plan.environment.CSC_IDENTITY_AUTO_DISCOVERY).toBe('false')
    expect(() => prepareMacSigning({ CSC_LINK: 'a-secret-value' }, projectDir)).toThrow('signing is disabled')
    expect(() => prepareMacSigning({ MACOS_SIGNING_ENABLED: 'ture' }, projectDir)).toThrow('true or false')
  })

  it('rejects missing credentials before creating key files and never echoes secrets', () => {
    const create = vi.spyOn(fs, 'mkdtempSync')
    const incomplete = { ...credentials, APPLE_API_KEY_ID: '' }
    expect(() => prepareMacSigning(incomplete, projectDir)).toThrow('APPLE_API_KEY_ID')
    expect(create).not.toHaveBeenCalled()
    expect(() => prepareMacSigning({ ...credentials, APPLE_TEAM_ID: 'invalid-team-secret' }, projectDir)).toThrow('10-character')
    for (const encoded of ['@invalid-secret@', Buffer.from('not-a-private-key-secret').toString('base64')]) {
      let caught: unknown
      try { prepareMacSigning({ ...credentials, APPLE_API_KEY_BASE64: encoded }, projectDir) }
      catch (error) { caught = error }
      expect(caught).toBeInstanceOf(Error)
      expect(String(caught)).not.toContain(encoded)
      expect(String(caught)).not.toContain('not-a-private-key-secret')
    }
    expect(create).not.toHaveBeenCalled()
  })

  it('writes a private temporary .p8 file and removes it after use', () => {
    const plan = prepareMacSigning(credentials, projectDir)
    cleanups.push(plan.cleanup)
    const keyPath = plan.environment.APPLE_API_KEY
    expect(fs.readFileSync(keyPath, 'utf8')).toBe(key)
    expect(plan.environment.CSC_IDENTITY_AUTO_DISCOVERY).toBe('true')
    if (process.platform !== 'win32') expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600)
    expect(plan.config.forceCodeSigning).toBe(true)
    expect(plan.config.mac).toMatchObject({ identity: team, type: 'distribution', hardenedRuntime: true, notarize: true })
    plan.cleanup()
    expect(fs.existsSync(path.dirname(keyPath))).toBe(false)
    expect(() => plan.cleanup()).not.toThrow()
  })

  it('removes temporary key material if preparation fails', () => {
    const write = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw new Error('test write failed') })
    expect(() => prepareMacSigning(credentials, projectDir)).toThrow('test write failed')
    const keyPath = String(write.mock.calls[0][0])
    expect(fs.existsSync(path.dirname(keyPath))).toBe(false)
  })

  it('passes the installed electron-builder schema and overrides the unsigned base config', async () => {
    const { getConfig, validateConfiguration } = require('app-builder-lib/out/util/config/config')
    const { DebugLogger } = require('builder-util')
    const plan = prepareMacSigning(credentials, projectDir)
    cleanups.push(plan.cleanup)
    const merged = await getConfig(projectDir, null, plan.config)
    await expect(validateConfiguration(merged, new DebugLogger(false))).resolves.toBeUndefined()
    expect(merged.mac).toMatchObject({ identity: team, target: ['dmg', 'zip'], type: 'distribution', hardenedRuntime: true, notarize: true })
    expect(merged.forceCodeSigning).toBe(true)
    expect(merged.mac.entitlements).toBe(merged.mac.entitlementsInherit)
    const entitlements = fs.readFileSync(merged.mac.entitlements, 'utf8')
    expect(entitlements).toContain('com.apple.security.cs.allow-jit')
    expect(entitlements).not.toMatch(/allow-unsigned-executable-memory|disable-library-validation/)
  })
})

type Run = (command: string, args: string[]) => string
function artifactRunner(fail?: (command: string, args: string[]) => void) {
  const calls: Array<{ command: string; args: string[] }> = []
  const directories = new Set<string>()
  const run: Run = (command, args) => {
    calls.push({ command, args })
    if (command.endsWith('/hdiutil') && args[0] === 'attach' || command.endsWith('/ditto')) {
      const payload = command.endsWith('/ditto') ? args.at(-1)! : args[args.indexOf('-mountpoint') + 1]
      directories.add(path.dirname(payload))
      fs.mkdirSync(path.join(payload, 'LiteConnect.app'))
    }
    fail?.(command, args)
    return args[0] === '--display' ? `Authority=Developer ID Application: Test (${team})\nTeamIdentifier=${team}\n` : ''
  }
  // Paths originate from the helper's mkdtemp; verify the known boundary before cleanup.
  cleanups.push(() => {
    for (const directory of directories) {
      expect(path.basename(directory)).toMatch(/^liteconnect-macos-verify-/)
      expect(path.dirname(directory)).toBe(path.resolve(require('node:os').tmpdir()))
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })
  return { run, calls, directories }
}

describe('macOS release artifact gate', () => {
  const artifacts = ['release/LiteConnect-arm64.dmg', 'release/LiteConnect-arm64.zip', 'release/latest-mac.yml']
  it('requires a Mac host and both distributed formats', () => {
    expect(() => verifyMacArtifacts(artifacts, team, { platform: 'win32' })).toThrow('macOS host')
    expect(() => verifyMacArtifacts(artifacts.slice(0, 1), team, { platform: 'darwin' })).toThrow('both DMG and ZIP')
  })

  it('verifies the signature, team, ticket and Gatekeeper on both shipped apps', () => {
    const { run, calls, directories } = artifactRunner()
    verifyMacArtifacts(artifacts, team, { platform: 'darwin', run })
    expect(calls.filter(call => call.args[0] === '--verify')).toHaveLength(2)
    expect(calls.filter(call => call.args[0] === '--display')).toHaveLength(2)
    expect(calls.filter(call => call.args[0] === 'stapler')).toHaveLength(2)
    expect(calls.filter(call => call.args[0] === '--assess')).toHaveLength(2)
    expect(calls.some(call => /xattr/.test(call.command))).toBe(false)
    for (const directory of directories) expect(fs.existsSync(directory)).toBe(false)
  })

  it('rejects a certificate from a different team', () => {
    const { run } = artifactRunner()
    const wrongTeam: Run = (command, args) => run(command, args).replace(`TeamIdentifier=${team}`, 'TeamIdentifier=ZZZZZ12345')
    expect(() => verifyMacArtifacts(artifacts, team, { platform: 'darwin', run: wrongTeam })).toThrow('Unexpected Developer ID')
  })

  it.each(['--verify', 'stapler', '--assess'])('stops publishing when %s fails and detaches the DMG', stage => {
    const { run, calls, directories } = artifactRunner((_command, args) => { if (args[0] === stage) throw new Error(`failed ${stage}`) })
    expect(() => verifyMacArtifacts(artifacts, team, { platform: 'darwin', run })).toThrow(`failed ${stage}`)
    expect(calls.at(-1)?.args[0]).toBe('detach')
    for (const directory of directories) expect(fs.existsSync(directory)).toBe(false)
  })

  it('detaches even when attach partially succeeds before reporting failure', () => {
    const { run, calls, directories } = artifactRunner((_command, args) => { if (args[0] === 'attach') throw new Error('partial attach') })
    expect(() => verifyMacArtifacts(artifacts, team, { platform: 'darwin', run })).toThrow('partial attach')
    expect(calls.at(-1)?.args[0]).toBe('detach')
    for (const directory of directories) expect(fs.existsSync(directory)).toBe(false)
  })

  it('retains the mount directory if detach fails, instead of recursively deleting it', () => {
    const { run, directories } = artifactRunner((_command, args) => { if (args[0] === 'detach') throw new Error('volume busy') })
    expect(() => verifyMacArtifacts(artifacts, team, { platform: 'darwin', run })).toThrow('volume busy')
    for (const directory of directories) expect(fs.existsSync(path.join(directory, 'payload', 'LiteConnect.app'))).toBe(true)
  })
})
