import { describe, expect, it } from 'vitest'
import { buildGroupTree } from './groupTree'
import type { Group } from './types/connection'

const group = (id: string, parentId?: string | null, order = 0): Group =>
  ({ id, name: id, parentId, order, isDefault: false })

describe('group tree', () => {
  it('orders siblings while keeping descendants together and disambiguates paths', () => {
    const tree = buildGroupTree([group('prod', 'project', 0), group('other', null, 1),
      group('project', null, 0), group('region', 'prod'), group('prod2', 'other')])
    expect(tree.rows.map(row => [row.group.id, row.depth])).toEqual([
      ['project', 0], ['prod', 1], ['region', 2], ['other', 0], ['prod2', 1],
    ])
    expect(tree.getPath('region')).toBe('project / prod / region')
    expect([...tree.getSubtreeIds('project')].sort()).toEqual(['prod', 'project', 'region'])
    expect(tree.getAncestors('region').map(item => item.id)).toEqual(['project', 'prod'])
  })

  it('keeps legacy groups and damaged trees reachable without infinite loops', () => {
    const tree = buildGroupTree([group('legacy'), group('orphan', 'missing'),
      group('self', 'self'), group('a', 'b'), group('b', 'a'), group('child', 'b')])
    expect(tree.rows).toHaveLength(6)
    expect(new Set(tree.rows.map(row => row.group.id)).size).toBe(6)
    expect(tree.getParentId('legacy')).toBeNull()
    expect(tree.getParentId('orphan')).toBeNull()
    expect(tree.getParentId('self')).toBeNull()
    expect(tree.getPath('child')).toBeTruthy()
    expect(tree.getSubtreeIds('missing').size).toBe(0)
  })

  it('supports deep nesting without recursive stack overflow', () => {
    const groups = Array.from({ length: 12000 }, (_, index) => group(String(index), index ? String(index - 1) : null))
    const tree = buildGroupTree(groups)
    expect(tree.rows.at(-1)?.depth).toBe(11999)
    expect(tree.getSubtreeIds('0').size).toBe(12000)
  })
})
