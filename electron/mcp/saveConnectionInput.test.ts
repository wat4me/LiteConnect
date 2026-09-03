import { describe, expect, it } from 'vitest'
import {
  defaultConnectionName,
  matchExistingSavedConnection,
  parseSaveConnectionInput,
} from './saveConnectionInput'

describe('parseSaveConnectionInput', () => {
  it('accepts password auth and defaults name/port', () => {
    const parsed = parseSaveConnectionInput({
      host: '10.0.0.8',
      username: 'deploy',
      password: 's3cret',
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value).toMatchObject({
      name: 'deploy@10.0.0.8',
      host: '10.0.0.8',
      port: 22,
      username: 'deploy',
      useAgent: false,
      connect: false,
    })
  })

  it('accepts useAgent without a password', () => {
    const parsed = parseSaveConnectionInput({
      host: 'bastion.example',
      username: 'ops',
      useAgent: true,
      connect: true,
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.value.useAgent).toBe(true)
    expect(parsed.value.connect).toBe(true)
    expect(parsed.value.password).toBe('')
  })

  it('rejects missing auth and bad host', () => {
    expect(parseSaveConnectionInput({ host: '10.0.0.8', username: 'root' }).ok).toBe(false)
    expect(parseSaveConnectionInput({ host: 'bad host', username: 'root', password: 'x' }).ok).toBe(false)
    expect(parseSaveConnectionInput({ host: '10.0.0.8', username: '', password: 'x' }).ok).toBe(false)
  })

  it('builds a name that includes a non-default port', () => {
    expect(defaultConnectionName('root', 'db.internal', 3306)).toBe('root@db.internal:3306')
  })
})

describe('matchExistingSavedConnection', () => {
  const row = { id: 'id-1', name: 'web', host: '10.0.0.8', port: 22, username: 'deploy' }

  it('reuses the same name+host+user+port', () => {
    expect(matchExistingSavedConnection([row], row)).toEqual({ kind: 'reuse', id: 'id-1' })
  })

  it('rejects the same name on a different host', () => {
    expect(
      matchExistingSavedConnection([row], { ...row, host: '10.0.0.9' }),
    ).toEqual({ kind: 'name-taken' })
  })

  it('creates when the name is new', () => {
    expect(
      matchExistingSavedConnection([row], { ...row, name: 'web-2' }),
    ).toEqual({ kind: 'create' })
  })
})
