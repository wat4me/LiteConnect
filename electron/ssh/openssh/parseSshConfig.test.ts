import { describe, expect, it } from 'vitest'
import { parseKnownHosts, parseProxyJumpSpec, parseSshConfig } from './parseSshConfig'

describe('parseSshConfig', () => {
  it('parses hostname, user, port, identity and forwards', () => {
    const hosts = parseSshConfig(`
Host *
  User ubuntu
Host prod
  HostName 10.0.0.8
  Port 2222
  IdentityFile ~/.ssh/id_ed25519
  ProxyJump jump@bastion:2200
  LocalForward 3306 127.0.0.1:3306
  RemoteForward 8080 localhost:80
  DynamicForward 1080
  ForwardX11 yes
`)
    const prod = hosts.find((h) => h.alias === 'prod')
    expect(prod).toMatchObject({
      hostName: '10.0.0.8',
      port: 2222,
      user: 'ubuntu',
      forwardX11: true,
    })
    expect(prod?.identityFiles[0]).toContain('id_ed25519')
    expect(prod?.localForwards).toEqual([{ localPort: 3306, remoteHost: '127.0.0.1', remotePort: 3306 }])
    expect(prod?.dynamicForwards).toEqual([{ localPort: 1080 }])
    expect(prod?.remoteForwards?.[0]).toMatchObject({ remotePort: 8080, localPort: 80 })
    expect(parseProxyJumpSpec(prod!.proxyJump!)).toEqual({
      host: 'bastion',
      port: 2200,
      user: 'jump',
    })
  })

  it('skips wildcard-only hosts', () => {
    const hosts = parseSshConfig('Host *.internal\n  User root\n')
    expect(hosts).toEqual([])
  })
})

describe('parseKnownHosts', () => {
  it('parses unhashed host and bracket port', () => {
    const { entries, hashedSkipped } = parseKnownHosts(`
# comment
example.com ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExamp1e
[10.0.0.1]:2222 ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC
|1|abc|def ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAISkip
`)
    expect(hashedSkipped).toBe(1)
    expect(entries[0]).toMatchObject({ host: 'example.com', port: 22, keyType: 'ssh-ed25519' })
    expect(entries[1]).toMatchObject({ host: '10.0.0.1', port: 2222, keyType: 'ssh-rsa' })
  })
})
