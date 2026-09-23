import { describe, expect, it } from 'vitest'
import {
  containsSensitiveShellValue,
  normalizeShellHistoryExcludePatterns,
  shouldStoreShellCommand,
} from './shellHistoryPrivacy'

describe('shell history privacy', () => {
  it.each([
    'export API_KEY=top-secret-value',
    'export GITHUB_TOKEN=top-secret-value',
    'curl -H "Authorization: Bearer abcdefghijklmnop" https://example.com',
    'curl -H "X-API-Key: abcdefghijklmnop" https://example.com',
    'psql postgres://alice:hunter2@example.com/app',
    'mysql -uroot -phunter2',
    'sshpass -p hunter2 ssh root@example.com',
    'echo github_pat_1234567890abcdefghijklmnop',
    'cat -----BEGIN OPENSSH PRIVATE KEY-----',
  ])('rejects a command containing a literal credential: %s', (command) => {
    expect(containsSensitiveShellValue(command)).toBe(true)
    expect(shouldStoreShellCommand(command)).toBe(false)
  })

  it.each([
    'curl https://example.com/token/status',
    'export API_KEY=$API_KEY',
    'curl -H "Authorization: Bearer $TOKEN" https://example.com',
    'docker login --password-stdin',
    'grep secret README.md',
  ])('keeps commands that mention secrets without embedding one: %s', (command) => {
    expect(containsSensitiveShellValue(command)).toBe(false)
    expect(shouldStoreShellCommand(command)).toBe(true)
  })

  it('honors the leading-space private-history convention', () => {
    expect(shouldStoreShellCommand(' ls -la')).toBe(false)
    expect(shouldStoreShellCommand('\tuname -a')).toBe(false)
  })

  it('rejects a LiteConnect connection notice captured by older builds', () => {
    expect(shouldStoreShellCommand('Connecting to 10.2.178.163...')).toBe(false)
    expect(shouldStoreShellCommand('ssh 10.2.178.163')).toBe(true)
  })

  it('supports safe user glob exclusions', () => {
    expect(shouldStoreShellCommand('vault read team/key', ['vault *'])).toBe(false)
    expect(shouldStoreShellCommand('kubectl get pods', ['vault *'])).toBe(true)
  })

  it('normalizes and bounds custom patterns', () => {
    expect(normalizeShellHistoryExcludePatterns([' vault * ', '', 'vault *', 42])).toEqual(['vault *'])
  })
})
