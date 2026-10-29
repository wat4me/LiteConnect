import { beforeEach, expect, it, vi } from 'vitest'
import type { AiExecutionService } from '../ai/execution/executionService'
import type { SettingsStore } from '../store/settingsStore'
import { ServiceIpcScope } from './serviceScope'
import { registerAiHandlers } from './registerAiHandlers'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  saveDialog: vi.fn(), write: vi.fn(), owned: vi.fn(), manage: vi.fn(), access: vi.fn(),
}))
vi.mock('electron', () => ({
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => mocks.handlers.set(name, handler), removeHandler: vi.fn() },
  BrowserWindow: { fromWebContents: () => undefined }, dialog: { showSaveDialog: mocks.saveDialog },
}))
vi.mock('fs/promises', async original => ({ ...await original<typeof import('fs/promises')>(), writeFile: mocks.write }))
vi.mock('../ai/workspace/workspaceScopes', () => ({ workspaceScopes: { owned: mocks.owned }, workspaceHistoryId: (id: string) => id }))
const settings = { init: async () => {}, initMigrations: async () => {} } as SettingsStore
const event = { sender: { id: 7 } }
const handler = (name: string) => mocks.handlers.get(`ai:${name}`)!
beforeEach(() => {
  vi.clearAllMocks(); mocks.handlers.clear()
  mocks.owned.mockImplementation((_id, owner) => { if (owner !== 7) throw new Error('Workspace is not open in this window') })
  mocks.manage.mockResolvedValue({ targets: [], storagePath: '/profile/app.sqlite', document: { id: 'doc', title: '../service:notes', content: '# Service\n\n/opt/app' } })
  mocks.access.mockReturnValue({ manage: mocks.manage })
  mocks.saveDialog.mockResolvedValue({ canceled: false, filePath: 'C:/chosen/notes.md' })
})
function setup() {
  const scope = new ServiceIpcScope()
  registerAiHandlers(settings, { knowledgeAccess: mocks.access } as unknown as AiExecutionService, () => 'host-history', scope)
  return scope
}
it('validates window ownership before exposing a workspace knowledge scope', async () => {
  setup()
  await handler('knowledge')(event, 'workspace:one', { action: 'overview' })
  expect(mocks.access).toHaveBeenCalledWith('workspace:one', 7)
  expect(mocks.manage).toHaveBeenCalledWith({ action: 'overview' })
  mocks.access.mockClear()
  await expect(handler('knowledge')({ sender: { id: 8 } }, 'workspace:one', { action: 'overview' })).rejects.toThrow('not open')
  expect(mocks.access).not.toHaveBeenCalled()
})
it('exports only scoped document content to the native dialog selection', async () => {
  setup()
  expect(await handler('exportKnowledge')(event, 'ssh-a', 'server-a', 'doc', 'C:/untrusted/path')).toBe(true)
  expect(mocks.manage).toHaveBeenCalledWith({ action: 'read', connectionId: 'server-a', documentId: 'doc' })
  expect(mocks.saveDialog).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: '.._service_notes.md' }))
  expect(mocks.write).toHaveBeenCalledExactlyOnceWith('C:/chosen/notes.md', '# Service\n\n/opt/app', 'utf8')
})
it('does not write when the user cancels export or the document is outside the scope', async () => {
  setup()
  mocks.saveDialog.mockResolvedValueOnce({ canceled: true })
  expect(await handler('exportKnowledge')(event, 'ssh-a', 'server-a', 'doc')).toBe(false)
  expect(mocks.write).not.toHaveBeenCalled()
  mocks.manage.mockRejectedValueOnce(new Error('KNOWLEDGE_OUT_OF_SCOPE'))
  mocks.saveDialog.mockClear()
  await expect(handler('exportKnowledge')(event, 'ssh-a', 'server-b', 'doc')).rejects.toThrow('OUT_OF_SCOPE')
  expect(mocks.saveDialog).not.toHaveBeenCalled()
  expect(mocks.write).not.toHaveBeenCalled()
})
it('exports linked summary entries with source IDs for traceability', async () => {
  setup()
  mocks.manage.mockResolvedValueOnce({ document: { title: 'MEMORY.md', content: '- Service guide', memoryEntries: [{ text: 'Service guide', documentIds: ['source-a'] }] } })
  await handler('exportKnowledge')(event, 'ssh-a', 'server-a', 'memory')
  expect(mocks.write).toHaveBeenCalledExactlyOnceWith('C:/chosen/notes.md', '- Service guide\n  - Source document IDs: source-a', 'utf8')
})
it('exports independent notes without empty source placeholders', async () => {
  setup()
  mocks.manage.mockResolvedValueOnce({ document: { title: 'MEMORY.md', content: '- Test server', memoryEntries: [{ text: 'Test server', documentIds: [] }] } })
  await handler('exportKnowledge')(event, 'ssh-a', 'server-a', 'memory')
  expect(mocks.write).toHaveBeenCalledExactlyOnceWith('C:/chosen/notes.md', '- Test server', 'utf8')
})
it('does not export after services stop while the save dialog is open', async () => {
  const scope = setup()
  let finish!: (value: unknown) => void
  mocks.saveDialog.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const exporting = handler('exportKnowledge')(event, 'ssh-a', 'server-a', 'doc')
  await vi.waitFor(() => expect(mocks.saveDialog).toHaveBeenCalledOnce())
  scope.dispose()
  finish({ canceled: false, filePath: 'C:/chosen/late.md' })
  await expect(exporting).rejects.toThrow('services are stopping')
  expect(mocks.write).not.toHaveBeenCalled()
})
