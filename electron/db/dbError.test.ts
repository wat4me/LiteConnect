import { describe, expect, it } from 'vitest'
import { classifyDbError, sanitizeDbErrorText, toIpcDbError } from './dbError'

describe('sanitizeDbErrorText', () => {
  it('redacts password and URL userinfo', () => {
    const s = sanitizeDbErrorText('fail password=supersecret host=db')
    expect(s).not.toContain('supersecret')
    expect(s).toMatch(/password=\*\*\*/i)

    const u = sanitizeDbErrorText('postgres://alice:s3cret@host/db')
    expect(u).not.toContain('s3cret')
    expect(u).not.toContain('alice:s3cret')
  })

  it('redacts private key blocks', () => {
    const s = sanitizeDbErrorText(
      'key -----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAK\n-----END RSA PRIVATE KEY----- bad',
    )
    expect(s).not.toContain('MIIEowIBAAK')
  })
})

describe('classifyDbError', () => {
  it('classifies auth', () => {
    const c = classifyDbError({ errno: 1045, message: 'Access denied for user' })
    expect(c.category).toBe('auth')
    expect(c.retryable).toBe(false)
  })

  it('classifies refused / timeout', () => {
    expect(classifyDbError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' }).category).toBe(
      'refused',
    )
    expect(classifyDbError({ code: 'ETIMEDOUT', message: 'connect ETIMEDOUT' }).category).toBe(
      'timeout',
    )
  })

  it('classifies deadlock and serialization as retryable', () => {
    expect(classifyDbError({ errno: 1213, message: 'Deadlock found' }).category).toBe('deadlock')
    expect(classifyDbError({ errno: 1213, message: 'Deadlock found' }).retryable).toBe(true)
    expect(classifyDbError({ code: '40001', message: 'could not serialize access' }).category).toBe(
      'serialization',
    )
  })

  it('classifies cancel and syntax', () => {
    expect(classifyDbError({ code: 'QUERY_CANCELLED', message: 'cancelled' }).category).toBe(
      'cancel',
    )
    expect(classifyDbError({ errno: 1064, message: 'You have an error in your SQL syntax' }).category).toBe(
      'syntax',
    )
  })

  it('classifies tunnel when hinted', () => {
    const c = classifyDbError(
      { message: 'socket hang up' },
      'mysql',
      { viaTunnel: true },
    )
    expect(c.category).toBe('tunnel')
    expect(c.retryable).toBe(true)
  })

  it('toIpcDbError never embeds secrets in message', () => {
    const e = toIpcDbError({
      message: 'Access denied password=hunter2 for user',
      errno: 1045,
    })
    expect(e.message).not.toContain('hunter2')
    expect((e as any).detail || '').not.toContain('hunter2')
  })

  it('classifies Oracle ORA codes', () => {
    expect(
      classifyDbError({ message: 'ORA-01017: invalid username/password', errorNum: 1017 }, 'oracle')
        .category,
    ).toBe('auth')
    expect(
      classifyDbError({ message: 'ORA-00933: SQL command not properly ended', errorNum: 933 }, 'oracle')
        .category,
    ).toBe('syntax')
    expect(
      classifyDbError({ message: 'ORA-12541: TNS:no listener', errorNum: 12541 }, 'oracle').category,
    ).toBe('refused')
    expect(
      classifyDbError({ message: 'ORA-00060: deadlock detected', errorNum: 60 }, 'oracle').category,
    ).toBe('deadlock')
  })

  it('redacts Oracle connect strings', () => {
    const s = sanitizeDbErrorText('NJS-500: connect to 10.0.0.5:1521/ORCLPDB1 failed')
    expect(s).not.toContain('10.0.0.5:1521/ORCLPDB1')
  })
})
