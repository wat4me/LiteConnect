import { describe, expect, it } from 'vitest'
import { isAbsolute } from 'path'
import {
  isValidHost,
  isValidPort,
  isValidUUID,
  isStrictPath,
  isSafeLocalPath,
  isValidUsername,
  isValidExecCommand,
  isValidClipboardText,
  isValidTransferId,
  clampExecTimeoutMs,
  validateConnectionParams,
} from './validation'
import {
  CLIPBOARD_MAX_CHARS,
  SSH_EXEC_DEFAULT_TIMEOUT_MS,
  SSH_EXEC_MAX_TIMEOUT_MS,
  SSH_EXEC_MIN_TIMEOUT_MS,
} from './constants'

describe('validation', () => {
  it('validates UUID', () => {
    expect(isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(isValidUUID('not-a-uuid')).toBe(false)
  })

  it('validates port', () => {
    expect(isValidPort(22)).toBe(true)
    expect(isValidPort(0)).toBe(false)
    expect(isValidPort(65536)).toBe(false)
  })

  it('validates host', () => {
    expect(isValidHost('example.com')).toBe(true)
    expect(isValidHost('10.0.0.1')).toBe(true)
    expect(isValidHost('')).toBe(false)
    expect(isValidHost('bad host')).toBe(false)
  })

  it('validates username', () => {
    expect(isValidUsername('root')).toBe(true)
    expect(isValidUsername('')).toBe(false)
  })

  it('strict path rejects traversal', () => {
    expect(isStrictPath('/home/user')).toBe(true)
    expect(isStrictPath('/home/../etc/passwd')).toBe(false)
  })

  it('safe local path requires absolute path without traversal', () => {
    if (process.platform === 'win32') {
      expect(isSafeLocalPath('C:\\Users\\test\\file.txt')).toBe(true)
      expect(isSafeLocalPath('C:\\Users\\test\\..\\secret')).toBe(false)
    } else {
      expect(isSafeLocalPath('/home/user/file.txt')).toBe(true)
      expect(isSafeLocalPath('/home/user/../etc/passwd')).toBe(false)
    }
    expect(isSafeLocalPath('relative/path')).toBe(false)
    expect(isSafeLocalPath('')).toBe(false)
    expect(isAbsolute('/tmp')).toBe(true)
  })

  it('validates exec command and transfer id', () => {
    expect(isValidExecCommand('ls -la')).toBe(true)
    expect(isValidExecCommand('')).toBe(false)
    expect(isValidExecCommand('a\0b')).toBe(false)
    expect(isValidTransferId('dl-123-abc')).toBe(true)
    expect(isValidTransferId('')).toBe(false)
  })

  it('clamps exec timeout', () => {
    expect(clampExecTimeoutMs(undefined)).toBe(SSH_EXEC_DEFAULT_TIMEOUT_MS)
    expect(clampExecTimeoutMs(10)).toBe(SSH_EXEC_MIN_TIMEOUT_MS)
    expect(clampExecTimeoutMs(999999)).toBe(SSH_EXEC_MAX_TIMEOUT_MS)
  })

  it('validates clipboard text length', () => {
    expect(isValidClipboardText('ok')).toBe(true)
    expect(isValidClipboardText('x'.repeat(CLIPBOARD_MAX_CHARS + 1))).toBe(false)
  })

  it('validateConnectionParams', () => {
    expect(
      validateConnectionParams({
        host: 'h',
        port: 22,
        username: 'u',
        password: 'p',
      }).valid,
    ).toBe(true)
    expect(
      validateConnectionParams({
        host: 'h',
        port: 22,
        username: 'u',
        connectionId: '550e8400-e29b-41d4-a716-446655440000',
      }).valid,
    ).toBe(true)
    expect(validateConnectionParams({ host: '', port: 22, username: 'u', password: '' }).valid).toBe(false)
    expect(
      validateConnectionParams({ host: 'h', port: 22, username: 'u', password: '', useAgent: true }).valid,
    ).toBe(true)
    expect(
      validateConnectionParams({ host: 'h', port: 22, username: 'u', password: '', useAgent: 'yes' }).valid,
    ).toBe(false)
  })
})
