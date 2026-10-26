import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ collections: new Map<string, unknown[]>() }))
vi.mock('electron', () => ({ safeStorage: { isEncryptionAvailable: () => false } }))
vi.mock('../i18n', () => ({ t: (key: string) => key }))
vi.mock('./appDatabase', () => ({
  COLLECTIONS: { sshGroups: 'groups', sshConnections: 'connections', savedCredentials: 'credentials' },
  getAppDatabase: () => ({
    getCollection: (name: string) => structuredClone(db.collections.get(name) || []),
    replaceCollection: (name: string, items: unknown[]) => db.collections.set(name, structuredClone(items)),
  }),
}))
import { CredentialStore } from './credentialStore'

async function setup() {
  const store = new CredentialStore()
  await store.init()
  return store
}
const connection = (name: string, group: string) =>
  ({ name, host: `${name}.example`, port: 22, username: 'user', password: '', group })

beforeEach(() => { db.collections.clear() })

describe('nested connection groups', () => {
  it('persists nested groups and preserves the parent when renaming', async () => {
    const store = await setup()
    const root = store.getGroups()[0]
    const child = await store.saveGroup({ name: 'Production', parentId: root.id })
    const leaf = await store.saveGroup({ name: 'Region', parentId: child.id })
    await store.saveGroup({ id: child.id, name: 'Staging' })
    const reloaded = await setup()
    expect(reloaded.getGroups().map(group => group.id)).toEqual([root.id, child.id, leaf.id])
    expect(reloaded.getGroups()[1]).toMatchObject({ name: 'Staging', parentId: root.id })
  })

  it('rejects missing parents, self moves and descendant moves before changing storage', async () => {
    const store = await setup()
    const root = store.getGroups()[0]
    const child = await store.saveGroup({ name: 'Child', parentId: root.id })
    const leaf = await store.saveGroup({ name: 'Leaf', parentId: child.id })
    const before = store.getGroups()
    for (const parentId of [root.id, child.id, leaf.id, 'missing']) {
      await expect(store.saveGroup({ id: root.id, name: root.name, parentId })).rejects.toThrow()
    }
    expect(store.getGroups()).toEqual(before)
    await store.saveGroup({ id: child.id, name: child.name, parentId: null })
    expect(store.getGroups().find(group => group.id === child.id)?.parentId).toBeNull()
    expect(store.getGroups().find(group => group.id === leaf.id)?.parentId).toBe(child.id)
  })

  it('promotes subgroups on deletion and preserves every connection', async () => {
    const store = await setup()
    const root = store.getGroups()[0]
    const child = await store.saveGroup({ name: 'Child', parentId: root.id })
    const leaf = await store.saveGroup({ name: 'Leaf', parentId: child.id })
    const direct = await store.saveConnection(connection('direct', child.id))
    const nested = await store.saveConnection(connection('nested', leaf.id))
    await store.deleteGroup(child.id)
    expect(store.getGroups().find(group => group.id === leaf.id)?.parentId).toBe(root.id)
    expect(store.getConnection(direct.id)?.group).toBe(root.id)
    expect(store.getConnection(nested.id)?.group).toBe(leaf.id)
    await store.deleteGroup(root.id)
    expect(store.getGroups()).toEqual([expect.objectContaining({ id: leaf.id, parentId: null, isDefault: true })])
    expect(store.getConnections()).toHaveLength(2)
    expect(store.getConnections().every(conn => conn.group === leaf.id)).toBe(true)
    await store.deleteGroup(leaf.id)
    expect(store.getGroups()).toHaveLength(1)
    expect(store.getConnections().every(conn => conn.group === store.getDefaultGroupId())).toBe(true)
  })

  it('repairs legacy roots, orphans and cycles on load', async () => {
    const ids = [1, 2, 3, 4].map(id => `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`)
    db.collections.set('groups', ids.map((id, index) => ({ id, name: String(index), order: index,
      isDefault: !index, parentId: [undefined, 'missing', ids[3], ids[2]][index] })))
    const store = await setup()
    expect(store.getGroups()).toHaveLength(4)
    expect(store.getGroups().find(group => group.id === ids[1])?.parentId).toBeNull()
    expect((await setup()).getGroups()).toEqual(store.getGroups())
  })

  it('round-trips hierarchy and same-named subgroups through export and import', async () => {
    const source = await setup()
    const project = await source.saveGroup({ name: 'Project' })
    const prod = await source.saveGroup({ name: 'Production', parentId: project.id })
    const sameName = await source.saveGroup({ name: 'Production', parentId: project.id })
    const leaf = await source.saveGroup({ name: 'Region', parentId: prod.id })
    await source.saveConnection(connection('one', leaf.id))
    await source.saveConnection(connection('two', sameName.id))
    const exportedGroups = source.getGroups()
    const exportedConnections = source.getConnectionsForExport(false)
    db.collections.clear()
    const target = await setup()
    expect(await target.importConnections(exportedConnections, exportedGroups)).toEqual({ imported: 2, skipped: 0, total: 2 })
    const groups = target.getGroups()
    const nestedGroup = groups.find(group => group.name === 'Region')!
    const prodGroup = groups.find(group => group.id === nestedGroup.parentId)!
    const projectGroup = groups.find(group => group.id === prodGroup.parentId)!
    expect(projectGroup.name).toBe('Project')
    expect(groups.filter(group => group.name === 'Production')).toHaveLength(2)
    expect(target.getConnections().find(conn => conn.name === 'one')?.group).toBe(nestedGroup.id)
    const count = groups.length
    expect((await target.importConnections(exportedConnections, exportedGroups)).skipped).toBe(2)
    expect(target.getGroups()).toHaveLength(count)
  })

  it('keeps legacy connection imports working without a groups array', async () => {
    const store = await setup()
    await store.importConnections([connection('old', 'unknown')])
    expect(store.getConnections()[0].group).toBe(store.getDefaultGroupId())
  })

  it('reorders groups without changing their ancestry', async () => {
    const store = await setup()
    const root = store.getGroups()[0]
    const first = await store.saveGroup({ name: 'First', parentId: root.id })
    const second = await store.saveGroup({ name: 'Second', parentId: root.id })
    await store.reorderGroups([root.id, second.id, first.id, second.id])
    expect(store.getGroups().map(group => group.id)).toEqual([root.id, second.id, first.id])
    expect(store.getGroups().slice(1).every(group => group.parentId === root.id)).toBe(true)
  })
})
