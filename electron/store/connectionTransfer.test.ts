import { describe, expect, it } from 'vitest'
import {
  mapImportedSshConnection,
  sanitizeLocalForwards,
  stripSecretsFromExport,
} from './connectionTransfer'

describe('connectionTransfer', () => {
  it('maps a full imported connection including key / jump / forwards', () => {
    const mapped = mapImportedSshConnection({
      name: 'prod',
      host: '10.0.0.1',
      port: 2222,
      username: 'op',
      password: 'p',
      privateKey: '-----BEGIN KEY-----',
      useAgent: true,
      jumpHost: 'bastion.local',
      jumpPort: 22,
      jumpUsername: 'jump',
      jumpPassword: 'jp',
      jumpPrivateKey: '-----BEGIN JUMP-----',
      localForwards: [{ localPort: 3306, remoteHost: 'db', remotePort: 3306 }],
      note: 'n',
      colorTag: 'red',
    })
    expect(mapped).toMatchObject({
      name: 'prod',
      host: '10.0.0.1',
      port: 2222,
      privateKey: '-----BEGIN KEY-----',
      useAgent: true,
      jumpHost: 'bastion.local',
      jumpPrivateKey: '-----BEGIN JUMP-----',
      localForwards: [{ localPort: 3306, remoteHost: 'db', remotePort: 3306 }],
    })
  })

  it('rejects incomplete rows', () => {
    expect(mapImportedSshConnection({ name: 'x' })).toBeNull()
    expect(mapImportedSshConnection(null)).toBeNull()
  })

  it('strips secrets from export copies', () => {
    const stripped = stripSecretsFromExport({
      name: 'a',
      host: 'h',
      port: 22,
      username: 'u',
      password: 'secret',
      privateKey: 'key',
      jumpPassword: 'jp',
      jumpPrivateKey: 'jk',
    })
    expect(stripped.password).toBe('')
    expect(stripped.privateKey).toBeUndefined()
    expect(stripped.jumpPassword).toBeUndefined()
    expect(stripped.jumpPrivateKey).toBeUndefined()
  })

  it('drops invalid forwards', () => {
    expect(sanitizeLocalForwards([{ localPort: 0, remoteHost: 'x', remotePort: 1 }])).toBeUndefined()
    expect(sanitizeLocalForwards([{ localPort: 1, remoteHost: 'x', remotePort: 2 }])).toEqual([
      { localPort: 1, remoteHost: 'x', remotePort: 2 },
    ])
  })
})
