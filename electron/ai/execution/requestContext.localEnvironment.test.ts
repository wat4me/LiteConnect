import { describe, expect, it } from 'vitest'
import { buildAiRequestEnvironment } from './requestContext'
import type { SshMcpRuntime } from '../../mcp/runtime'

const sessionId = '550e8400-e29b-41d4-a716-446655440000'
const targets = [{ sessionId, connectionId: 'host-one', name: 'Linux server', host: 'linux.test', port: 22, username: 'ops' }]

describe('local context for file transfers', () => {
  it.each([false, true])('includes the local OS and live default download directory (workspace: %s)', async workspace => {
    let directory = 'C:\\Users\\operator\\Downloads'
    const runtime = {
      call: async () => ({ structuredContent: { sessions: [{ sessionId, connectionName: 'Linux server' }] } }),
      getLocalEnvironment: () => ({ platform: 'win32', defaultDownloadDirectory: directory }),
    } as unknown as SshMcpRuntime
    const environment = await buildAiRequestEnvironment({ sessionId, workspaceTargets: workspace ? targets : undefined, sshMcpRuntime: runtime, toolGroups: ['file_transfer'] })
    expect(environment.extraSystem).toContain(JSON.stringify({ platform: 'win32', defaultDownloadDirectory: directory }))
    expect(environment.extraSystem).toContain('省略 localPath')
    expect(environment.extraSystem).toContain('不能用它们查询或验证本地电脑的目录')
    expect(environment.extraSystem).toContain('远端 Linux 的 /tmp 仅是服务器目录')
    const download = environment.tools!.find(tool => tool.function.name === 'download_file')!
    expect(download.function.parameters.required).not.toContain('localPath')
    directory = 'D:\\team-downloads'
    const next = await buildAiRequestEnvironment({ sessionId, workspaceTargets: workspace ? targets : undefined, sshMcpRuntime: runtime })
    expect(next.extraSystem).toContain(JSON.stringify(directory))
    expect(next.extraSystem).not.toContain('C:\\\\Users')
  })
})
