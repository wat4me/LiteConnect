import { expect, it } from 'vitest'
import { AI_CHAT_SERVER_TOOLS, AI_TOOL_GROUPS, aiToolGroupsFromHistory, normalizeAiToolGroups, parseAiToolGroupRequest } from './aiToolCatalog'
import { sshToolsForChat, sidebarToolSchemaTokens } from './aiSidebarPrompt'
import { workspaceToolsForChat } from './aiWorkspacePrompt'
import { sshMcpToolsAsOpenAiFunctions } from './mcp/tools'
import { formatToolRunDisplay } from './aiToolRunDisplay'
import { aiToolSchemaTokens } from './aiContextPressure'

it('starts with common tools and a local loader, without changing external MCP capabilities', () => {
  const external = structuredClone(sshMcpToolsAsOpenAiFunctions())
  const names = sshToolsForChat().map(tool => tool.function.name)
  expect(names.sort()).toEqual(['exec', 'read_file', 'write_file', 'edit_file', 'grep', 'get_job', 'cancel_job', 'ask_user', 'load_tools'].sort())
  const workspace = workspaceToolsForChat()
  const loader = workspace.find(tool => tool.function.name === 'load_tools')!.function
  expect(loader.parameters.properties).not.toHaveProperty('connectionId')
  expect(loader.parameters.properties).not.toHaveProperty('risk')
  for (const name of ['list_dir', 'stat_path', 'glob', 'tail_file', 'service_control', 'get_metrics']) {
    expect(AI_CHAT_SERVER_TOOLS.has(name)).toBe(false)
    expect(external.some(tool => tool.function.name === name)).toBe(true)
  }
  expect(sshMcpToolsAsOpenAiFunctions()).toEqual(external)
})

it('loads only requested groups in stable order and budgets exactly the selected schemas', () => {
  const groups = ['file_transfer', 'interactive_terminal'] as const
  const tools = workspaceToolsForChat(groups)
  const names = tools.map(tool => tool.function.name)
  for (const name of [...AI_TOOL_GROUPS.file_transfer, ...AI_TOOL_GROUPS.interactive_terminal]) expect(names).toContain(name)
  expect(names).not.toContain('list_jobs')
  expect(workspaceToolsForChat([...groups].reverse())).toEqual(tools)
  expect(sidebarToolSchemaTokens(groups)).toBe(aiToolSchemaTokens(sshToolsForChat(groups)))
  expect(sidebarToolSchemaTokens()).toBeLessThan(sidebarToolSchemaTokens(groups))
  expect(aiToolSchemaTokens(workspaceToolsForChat())).toBeLessThan(3500)
  for (const tool of tools.filter(tool => !['ask_user', 'load_tools'].includes(tool.function.name))) {
    expect(tool.function.parameters.required).toEqual(expect.arrayContaining(['risk', 'explanation', 'connectionId']))
    expect(tool.function.parameters.properties).not.toHaveProperty('confirmed')
  }
})

it('validates entire load requests and ignores unknown persisted group names', () => {
  for (const value of [null, [], 'file_transfer', ['file_transfer', 'ask_user'], ['__proto__'], ['constructor'], [3]]) expect(parseAiToolGroupRequest(value)).toBeUndefined()
  expect(parseAiToolGroupRequest(['job_overview', 'file_transfer'])).toEqual(['file_transfer', 'job_overview'])
  expect(normalizeAiToolGroups(['constructor', 'file_transfer', 'file_transfer'])).toEqual(['file_transfer'])
})

it('remembers successful loads and legacy capability use but ignores blocked and malformed calls', () => {
  const run = (name: string, args = '{}', isError = false, status = 'done' as const) => ({ id: name, name, args, content: '', isError, status })
  expect(aiToolGroupsFromHistory([{ toolRuns: [
    run('load_tools', '{"groups":["file_transfer"]}'), run('pty_close'),
    run('load_tools', '{"groups":["job_overview"]}', true), run('load_tools', '{'),
  ] }])).toEqual(['file_transfer', 'interactive_terminal'])
  expect(formatToolRunDisplay({ name: 'load_tools', args: '{"groups":["file_transfer","interactive_terminal"]}', content: '{}' }).hint).toBe('文件传输、交互式终端')
})
