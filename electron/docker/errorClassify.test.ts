import { describe, expect, it } from 'vitest'
import { classifyStreamLocalError } from './errorClassify'
import { DockerTransportError } from './types'

describe('classifyStreamLocalError', () => {
  it('classifies StreamLocal unsupported', () => {
    const u = classifyStreamLocalError(new Error('openssh_forwardOutStreamLocal is not supported'))
    expect(u.code).toBe('transport-unsupported')

    const u2 = classifyStreamLocalError(new Error('Administratively prohibited'))
    expect(u2.code).toBe('transport-unsupported')
  })

  it('classifies channel open failed as socket-forward-failed (not daemon-unavailable)', () => {
    const e = classifyStreamLocalError(new Error('Channel open failure: open failed'))
    expect(e.code).toBe('socket-forward-failed')

    const e2 = classifyStreamLocalError(
      new Error('channel open failed: connect failed: open failed'),
    )
    expect(e2.code).toBe('socket-forward-failed')

    const e3 = classifyStreamLocalError(new Error('StreamLocal open failed'))
    expect(e3.code).toBe('socket-forward-failed')
  })

  it('classifies socket not found', () => {
    const e = classifyStreamLocalError(Object.assign(new Error('connect ENOENT'), { code: 'ENOENT' }))
    expect(e.code).toBe('socket-not-found')

    const e2 = classifyStreamLocalError(new Error('No such file or directory'))
    expect(e2.code).toBe('socket-not-found')
  })

  it('classifies permission denied', () => {
    const e = classifyStreamLocalError(Object.assign(new Error('EACCES'), { code: 'EACCES' }))
    expect(e.code).toBe('permission-denied')

    const e2 = classifyStreamLocalError(new Error('Permission denied'))
    expect(e2.code).toBe('permission-denied')
  })

  it('passes through DockerTransportError', () => {
    const orig = new DockerTransportError('proxy-closed', 'gone', 's1')
    expect(classifyStreamLocalError(orig)).toBe(orig)
  })
})
