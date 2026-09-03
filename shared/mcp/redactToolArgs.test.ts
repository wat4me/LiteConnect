import { describe, expect, it } from 'vitest'
import { redactToolArgsJson, redactToolArgsRecord } from './redactToolArgs'

describe('redactToolArgs', () => {
  it('masks password and privateKey, keeps host', () => {
    expect(
      redactToolArgsRecord({
        host: '10.0.0.8',
        username: 'root',
        password: 's3cret',
        privateKey: '-----BEGIN',
      }),
    ).toEqual({
      host: '10.0.0.8',
      username: 'root',
      password: '***',
      privateKey: '***',
    })
  })

  it('redacts JSON arguments used in history', () => {
    expect(JSON.parse(redactToolArgsJson(JSON.stringify({ password: 'x', host: 'a' })))).toEqual({
      password: '***',
      host: 'a',
    })
  })
})
