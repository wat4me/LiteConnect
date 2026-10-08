import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import type { Connection, Group } from '@/env.d.ts'
import { useConnectionList } from './useConnectionList'

vi.mock('vue', async (importOriginal) => ({
  ...await importOriginal<typeof import('vue')>(),
  onMounted: (callback: () => void) => callback(),
  onBeforeUnmount: () => {},
}))
vi.mock('@/i18n', () => ({ t: (key: string) => key }))
vi.mock('element-plus/es/components/message/index', () => ({
  ElMessage: { info: vi.fn(), error: vi.fn(), success: vi.fn() },
}))
vi.mock('@/utils/shared/dragAutoScroll', () => ({
  createDragAutoScroll: () => ({ start: vi.fn(), stop: vi.fn() }),
}))

// The composable runs in Vue's real reactive scope. A small DOM double allows
// keyboard targets and document listeners to be exercised in the Node suite.
class ElementDouble {
  tagName = 'DIV'
  isContentEditable = false
  offsetParent = {}
  inside = true
  action = false
  getClientRects = () => [{}]
  contains = (element: ElementDouble) => element.inside
  closest = () => this.action ? this : null
  querySelector = () => null
  focus = vi.fn()
  select = vi.fn()
  blur = vi.fn()
}

const groups = [
  { id: 'production', name: '生产', isDefault: true },
  { id: 'test', name: '测试' },
] as Group[]
const connections = [
  { id: 'one', name: 'web-one', host: 'one.example', username: 'root', group: 'production', order: 0 },
  { id: 'two', name: 'web-two', host: 'two.example', username: 'root', group: 'test', order: 1, colorTag: 'red' },
  { id: 'three', name: 'database', host: 'three.example', username: 'admin', group: 'production', order: 2 },
] as Connection[]

let scope: EffectScope
let keydown: (event: KeyboardEvent) => void
let overlay: object | null
let modal: boolean
let search: ElementDouble
let root: ElementDouble
let connect: ReturnType<typeof vi.fn>
let reorder: ReturnType<typeof vi.fn>
let moveGroup: ReturnType<typeof vi.fn>

function setup() {
  scope = effectScope()
  return scope.run(() => useConnectionList({
    initialData: ref({ connections: [...connections], groups: [...groups] }),
    pageRootRef: ref(root as unknown as HTMLElement),
    getSearchInput: () => search as unknown as HTMLInputElement,
    isModalOpen: () => modal,
    onConnect: connect,
  }))!
}

function press(key: string, target: ElementDouble = search, extra = {}) {
  const preventDefault = vi.fn()
  keydown({ key, target, preventDefault, ...extra } as unknown as KeyboardEvent)
  return preventDefault
}

beforeEach(() => {
  overlay = null
  modal = false
  root = new ElementDouble()
  search = new ElementDouble()
  search.tagName = 'INPUT'
  connect = vi.fn()
  reorder = vi.fn().mockResolvedValue(undefined)
  moveGroup = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('HTMLElement', ElementDouble)
  vi.stubGlobal('document', {
    querySelectorAll: () => overlay ? [overlay] : [],
    addEventListener: (name: string, listener: typeof keydown) => {
      if (name === 'keydown') keydown = listener
    },
  })
  vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    LiteConnect: {
      reorderConnections: reorder,
      updateConnectionGroup: moveGroup,
      getConnections: vi.fn().mockResolvedValue(connections),
      getGroups: vi.fn().mockResolvedValue(groups),
    },
  })
})

afterEach(() => {
  scope?.stop()
  vi.unstubAllGlobals()
})

describe('connection search scope', () => {
  it('searches the current group by default and includes other groups in all scope', () => {
    const list = setup()
    list.searchQuery.value = ' web '
    expect(list.filteredConnections.value.map(c => c.id)).toEqual(['one'])
    list.searchScope.value = 'all'
    expect(list.filteredConnections.value.map(c => c.id)).toEqual(['one', 'two'])
    expect(list.activeGroupName.value).toBe('connections.allConnections')
    expect(list.getConnectionGroupName(connections[1])).toBe('测试')
    list.colorTagFilter.value = 'red'
    expect(list.filteredConnections.value.map(c => c.id)).toEqual(['two'])
  })

  it('keeps all scope consistent when cleared and returns to group scope on sidebar selection', () => {
    const list = setup()
    list.searchScope.value = 'all'
    expect(list.filteredConnections.value).toHaveLength(3)
    list.onSelectGroup('test')
    expect(list.searchScope.value).toBe('group')
    expect(list.filteredConnections.value.map(c => c.id)).toEqual(['two'])
    expect(list.activeGroupName.value).toBe('测试')
  })

  it('disables cross-group reordering while retaining group moves', async () => {
    const list = setup()
    list.searchScope.value = 'all'
    expect(list.reorderDisabled.value).toBe(true)
    list.dragConnId.value = 'one'
    list.dropInsertIndex.value = 2
    await list.onConnRowDrop({ preventDefault: vi.fn() } as unknown as DragEvent)
    expect(reorder).not.toHaveBeenCalled()
    await list.onMoveConnection('one', 'test')
    expect(moveGroup).toHaveBeenCalledWith('one', 'test')
    list.onSelectGroup('production')
    expect(list.reorderDisabled.value).toBe(false)
  })

  it('does not show insertion markers in all scope', () => {
    const list = setup()
    list.searchScope.value = 'all'
    list.dragConnId.value = 'one'
    const preventDefault = vi.fn()
    list.onConnRowDragOver({ preventDefault } as unknown as DragEvent, 1)
    expect(preventDefault).not.toHaveBeenCalled()
    expect(list.dropInsertIndex.value).toBeNull()
  })
})

describe('connection keyboard quick connect', () => {
  it('connects the first match with Enter and navigates results across groups', async () => {
    const list = setup()
    list.searchScope.value = 'all'
    list.searchQuery.value = 'web'
    await nextTick()
    press('Enter')
    expect(connect).toHaveBeenLastCalledWith('one')
    press('ArrowDown')
    press('ArrowDown')
    press('Enter')
    expect(connect).toHaveBeenLastCalledWith('two')
    await nextTick()
  })

  it('resets a stale selection when the search query or scope changes', async () => {
    const list = setup()
    list.searchScope.value = 'all'
    press('ArrowDown')
    press('ArrowDown')
    list.searchQuery.value = 'database'
    await nextTick()
    expect(list.listKeyboardIndex.value).toBe(-1)
    press('Enter')
    expect(connect).toHaveBeenLastCalledWith('three')
  })

  it('ignores IME confirmation, repeat and modified Enter', () => {
    const list = setup()
    list.searchQuery.value = 'web'
    press('Enter', search, { isComposing: true })
    press('Enter', search, { keyCode: 229 })
    press('Enter', search, { repeat: true })
    press('Enter', search, { ctrlKey: true })
    press('Enter', search, { defaultPrevented: true })
    expect(connect).not.toHaveBeenCalled()
  })

  it('does not steal keys from action buttons, other inputs, outside the page or overlays', () => {
    const list = setup()
    list.listKeyboardIndex.value = 0
    const button = new ElementDouble()
    button.action = true
    const outside = new ElementDouble()
    outside.inside = false
    const otherInput = new ElementDouble()
    otherInput.tagName = 'INPUT'
    expect(press('Enter', button)).not.toHaveBeenCalled()
    expect(press('Enter', outside)).not.toHaveBeenCalled()
    expect(press('Enter', otherInput)).not.toHaveBeenCalled()
    overlay = new ElementDouble()
    expect(press('Enter')).not.toHaveBeenCalled()
    overlay = { getClientRects: () => [] }
    press('Enter')
    expect(connect).toHaveBeenCalledTimes(1)
    connect.mockClear()
    overlay = null
    modal = true
    expect(press('Enter')).not.toHaveBeenCalled()
    expect(connect).not.toHaveBeenCalled()
  })

  it('clears search with Escape and focuses it with slash', () => {
    const list = setup()
    list.searchQuery.value = 'web'
    press('Escape')
    expect(list.searchQuery.value).toBe('')
    press('Escape')
    expect(search.blur).toHaveBeenCalled()
    press('/', root)
    expect(search.focus).toHaveBeenCalled()
    expect(search.select).toHaveBeenCalled()
  })
})
