import { computed, nextTick, onScopeDispose, ref, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus/es/components/message/index'
import type { Connection, Group } from '@shared/types/connection'
import { AI_WORKSPACE_MAX_HOSTS } from '@shared/aiWorkspace'
import { groupAiWorkspaceHosts } from '@/utils/ai/workspaceHosts'

/** Server browsing and picker state; connection ownership stays in the workspace. */
export function useAiWorkspaceHosts(deps: {
  connections: Ref<Connection[]>
  groups: Ref<Group[]>
  sessions: Ref<Record<string, string>>
  selectionLocked: Ref<boolean>
  selectedId: () => string
  browsing: () => boolean
  scoped: () => boolean
  scopeBusy: () => boolean
}) {
  const { t } = useI18n()
  const { connections, groups, sessions, selectionLocked } = deps
  const query = ref('')
  const pickerSelection = ref<string[]>([])
  const browserSelection = ref<string[]>([])
  const browserSelectionHosts = computed(() => browserSelection.value.flatMap(id => connections.value.find(host => host.id === id) || []))
  const hostView = ref<'cards' | 'list'>(readHostView())
  const hostFilter = ref<'all' | 'connected'>('all')
  const collapsedGroups = ref<Record<string, boolean>>({})
  const hostPicker = ref<'switch' | 'new' | 'create' | null>(null)
  const pickerQuery = ref('')
  const pickerCollapsedGroups = ref<Record<string, boolean>>({})
  const pickerElement = ref<HTMLElement | null>(null)
  let pickerReturnFocus: HTMLElement | null = null
  let disposed = false
  onScopeDispose(() => { disposed = true; pickerReturnFocus = null })
  const visible = computed(() => {
    const text = query.value.trim().toLocaleLowerCase()
    return connections.value.filter(connection =>
      (hostFilter.value === 'all' || !!sessions.value[connection.id]) &&
      (!text || `${connection.name} ${connection.host} ${connection.username} ${connection.note || ''} ${groupName(connection)}`.toLocaleLowerCase().includes(text)),
    )
  })
  const pickerHosts = computed(() => {
    const text = pickerQuery.value.trim().toLocaleLowerCase()
    return connections.value
      .filter(connection => {
        if (hostPicker.value === 'new' && connection.id === deps.selectedId()) return false
        if (!text) return true
        return `${connection.name} ${connection.host} ${connection.username} ${connection.note || ''} ${groupName(connection)}`.toLocaleLowerCase().includes(text)
      })
  })
  const groupedHosts = computed(() => groupConnections(visible.value))
  const pickerGroups = computed(() => groupConnections(pickerHosts.value, true))
  const allResultsSelected = computed(() => !!visible.value.length && visible.value.every(host => browserSelection.value.includes(host.id)))
  const canSelectResults = computed(() => allResultsSelected.value || new Set([...browserSelection.value, ...visible.value.map(host => host.id)]).size <= AI_WORKSPACE_MAX_HOSTS)

  function toggleBrowserHost(connectionId: string) {
    if (disposed || selectionLocked.value) return
    if (browserSelection.value.includes(connectionId)) {
      browserSelection.value = browserSelection.value.filter(id => id !== connectionId)
    } else if (browserSelection.value.length < AI_WORKSPACE_MAX_HOSTS) {
      browserSelection.value = [...browserSelection.value, connectionId]
    } else ElMessage.warning(t('ai.workspace.selectionLimit', { count: AI_WORKSPACE_MAX_HOSTS }))
  }
  function toggleResults() {
    if (selectionLocked.value || !canSelectResults.value) return
    const ids = new Set(visible.value.map(host => host.id))
    browserSelection.value = allResultsSelected.value
      ? browserSelection.value.filter(id => !ids.has(id))
      : [...new Set([...browserSelection.value, ...ids])]
  }


  function groupConnections(hosts: Connection[], connectedFirst = false) {
    return groupAiWorkspaceHosts(hosts, groups.value, { connectedFirst, sessions: sessions.value, unknownGroup: t('ai.workspace.unknownGroup'), ungrouped: t('ai.workspace.ungrouped') })
  }
  function readHostView(): 'cards' | 'list' {
    try { return localStorage.getItem('LiteConnect.aiWorkspace.hostView') === 'cards' ? 'cards' : 'list' }
    catch { return 'list' }
  }

  function resetFilters() {
    query.value = ''
    hostFilter.value = 'all'
  }

  function groupName(connection: Connection) {
    return groups.value.find(group => group.id === connection.group)?.name ||
      t(connection.group ? 'ai.workspace.unknownGroup' : 'ai.workspace.ungrouped')
  }
  function groupKey(id: string) { return id || '__ungrouped__' }
  function isCollapsed(id: string) { return !!collapsedGroups.value[groupKey(id)] }
  function toggleGroup(id: string) {
    const key = groupKey(id)
    collapsedGroups.value = { ...collapsedGroups.value, [key]: !collapsedGroups.value[key] }
  }
  function isPickerGroupCollapsed(id: string) {
    return !pickerQuery.value.trim() && !!pickerCollapsedGroups.value[id]
  }
  function togglePickerGroup(id: string) {
    pickerCollapsedGroups.value = { ...pickerCollapsedGroups.value, [id]: !isPickerGroupCollapsed(id) }
  }
  function openHostPicker(mode: 'switch' | 'new' | 'create', initialIds?: string[]) {
    if (selectionLocked.value) return
    pickerSelection.value = [...(initialIds || (deps.browsing() ? browserSelection.value : []))]
    if (deps.scoped() && mode === 'new') mode = 'create'
    pickerReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    pickerQuery.value = ''
    pickerCollapsedGroups.value = {}
    hostPicker.value = mode
    void nextTick(() => { if (!disposed && hostPicker.value) pickerElement.value?.querySelector<HTMLInputElement>('input')?.focus() })
  }

  function closeHostPicker() {
    if (deps.scopeBusy()) return
    hostPicker.value = null
    pickerQuery.value = ''
    const target = pickerReturnFocus
    pickerReturnFocus = null
    void nextTick(() => { if (!disposed && !hostPicker.value && target?.isConnected) target.focus() })
  }

  function trapPickerFocus(event: KeyboardEvent) {
    const controls = Array.from(pickerElement.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input') || [])
      .filter(element => element.getClientRects().length > 0)
    if (!controls?.length) return
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  watch(hostView, value => {
    try { localStorage.setItem('LiteConnect.aiWorkspace.hostView', value) }
    catch { /* Browsing works when local storage is unavailable. */ }
  })
  watch(connections, hosts => {
    browserSelection.value = browserSelection.value.filter(id => hosts.some(host => host.id === id))
    pickerSelection.value = pickerSelection.value.filter(id => hosts.some(host => host.id === id))
  }, { flush: 'sync' })
  return { query, pickerSelection, browserSelection, browserSelectionHosts,
    hostView, hostFilter, hostPicker, pickerQuery, pickerElement,
    visible, pickerHosts, groupedHosts, pickerGroups, allResultsSelected, canSelectResults,
    toggleBrowserHost, toggleResults, resetFilters, groupName,
    isCollapsed, toggleGroup, isPickerGroupCollapsed, togglePickerGroup,
    openHostPicker, closeHostPicker, trapPickerFocus }
}
