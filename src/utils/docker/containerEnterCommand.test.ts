import { describe, expect, it } from 'vitest'
import { isContainerEnterCommand } from '@/utils/docker/containerEnterCommand'

describe('isContainerEnterCommand', () => {
  it('detects docker exec variants', () => {
    expect(isContainerEnterCommand('docker exec -it abc bash')).toBe(true)
    expect(isContainerEnterCommand('docker exec -i web sh')).toBe(true)
    expect(isContainerEnterCommand('sudo docker exec -it c /bin/bash')).toBe(true)
    expect(isContainerEnterCommand('FOO=1 docker exec c sh')).toBe(true)
  })

  it('detects docker attach and interactive run', () => {
    expect(isContainerEnterCommand('docker attach myc')).toBe(true)
    expect(isContainerEnterCommand('docker run -it --rm alpine sh')).toBe(true)
    expect(isContainerEnterCommand('docker run -d nginx')).toBe(false)
  })

  it('detects compose / podman / kubectl', () => {
    expect(isContainerEnterCommand('docker compose exec web bash')).toBe(true)
    expect(isContainerEnterCommand('docker-compose exec app sh')).toBe(true)
    expect(isContainerEnterCommand('podman exec -it x bash')).toBe(true)
    expect(isContainerEnterCommand('kubectl exec -it pod/x -- bash')).toBe(true)
  })

  it('ignores normal commands and host docker inspect', () => {
    expect(isContainerEnterCommand('cd /tmp')).toBe(false)
    expect(isContainerEnterCommand('ls -la')).toBe(false)
    expect(isContainerEnterCommand('docker ps')).toBe(false)
    expect(isContainerEnterCommand('docker logs -f c')).toBe(false)
    expect(isContainerEnterCommand('docker start c')).toBe(false)
  })

  it('detects enter command in a compound line', () => {
    expect(isContainerEnterCommand('cd /opt && docker exec -it seeyon bash')).toBe(true)
    expect(isContainerEnterCommand('pwd; docker exec -it c sh')).toBe(true)
  })
})
