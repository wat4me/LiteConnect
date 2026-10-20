import { computed, nextTick, onScopeDispose, ref, watch, type Ref } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { aiModelId } from '@shared/aiContext'
import type { AiSettings } from '@shared/types/ai'
import { placePopupNearAnchor } from '@/utils/shared/popupPosition'

export function useAiSidebarModelMenu(deps: {
  settings: Ref<AiSettings>
  loading: () => boolean
  saving: () => boolean
  active: () => boolean
  refreshSettings: () => Promise<unknown>
  replaceSettings: (settings: AiSettings) => void
  applyExternal: (settings: AiSettings) => void
  closeHistory: () => void
  t: (key: string) => string
}) {
  const showSettings = ref(false)
  const showModelSwitcher = ref(false)
  const modelSwitcherButtonRef = ref<HTMLButtonElement | null>(null)
  const modelSwitcherDropdownRef = ref<HTMLElement | null>(null)
  const modelSwitcherStyle = ref<Record<string, string>>({})
  const modelSwitcherGroups = computed(() => (deps.settings.value.providers || [])
    .filter(provider => provider.models.length > 0)
    .map(provider => ({
      providerId: provider.id, providerName: provider.name,
      models: provider.models.map(model => {
        const id = aiModelId(model)
        return { providerId: provider.id, model: id, label: model.displayName || id,
          active: provider.id === deps.settings.value.activeProviderId && id === deps.settings.value.activeModel }
      }).filter(model => model.model),
    })).filter(group => group.models.length > 0))
  let disposed = false
  let settingsRequest = 0
  let positionVersion = 0
  let frame = 0
  let releaseFrame: (() => void) | undefined
  let focusOnOpen: 'active' | 'first' | 'last' = 'active'
  let switching = false

  function modelButtons() {
    return Array.from(modelSwitcherDropdownRef.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled)') || [])
  }
  function closeModelSwitcher(restoreFocus = false) {
    showModelSwitcher.value = false
    if (restoreFocus && !disposed && deps.active()) modelSwitcherButtonRef.value?.focus({ preventScroll: true })
  }
  function openModelSwitcher(focus: typeof focusOnOpen = 'active') {
    if (disposed || !deps.active() || deps.loading() || deps.saving() || switching) return
    focusOnOpen = focus
    showModelSwitcher.value = true
  }
  function toggleModelSwitcher() {
    if (showModelSwitcher.value) closeModelSwitcher(true)
    else openModelSwitcher()
  }
  function onModelMenuKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      closeModelSwitcher(true)
    } else if (event.key === 'Tab') {
      // Let native Tab continue from the trigger after the teleported menu closes.
      closeModelSwitcher(true)
    } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const rows = modelButtons()
      if (!rows.length) return
      const index = rows.indexOf(document.activeElement as HTMLButtonElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length
      rows[next]?.focus({ preventScroll: true })
    }
  }

  function cancelPositioning() {
    positionVersion++
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    releaseFrame?.()
    releaseFrame = undefined
  }

  async function positionModelSwitcher() {
    cancelPositioning()
    const version = positionVersion
    await nextTick()
    const current = () => !disposed && deps.active() && showModelSwitcher.value && version === positionVersion
    if (!current()) return
    await new Promise<void>(resolve => {
      releaseFrame = resolve
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => { frame = 0; releaseFrame = undefined; resolve() })
      })
    })
    if (!current()) return
    const button = modelSwitcherButtonRef.value
    const dropdown = modelSwitcherDropdownRef.value
    if (!button || !dropdown) return
    const pos = placePopupNearAnchor(button.getBoundingClientRect(), {
      width: dropdown.offsetWidth || 200, height: dropdown.offsetHeight || 120,
    }, { align: 'end', gap: 6, prefer: 'above' })
    modelSwitcherStyle.value = { left: `${pos.left}px`, top: `${pos.top}px`,
      ...(pos.maxHeight > 0 ? { maxHeight: `${pos.maxHeight}px` } : {}) }
    await nextTick()
    if (!current()) return
    const rows = modelButtons()
    const selected = rows.find(row => row.getAttribute('aria-checked') === 'true')
    const focusTarget = focusOnOpen === 'last' ? rows.at(-1) : focusOnOpen === 'first' ? rows[0] : selected || rows[0]
    focusTarget?.focus({ preventScroll: true })
  }
  watch(showModelSwitcher, open => { if (open) void positionModelSwitcher(); else cancelPositioning() })

  async function switchModel(providerId: string, model: string) {
    closeModelSwitcher(true)
    if (disposed || !model || deps.loading() || deps.saving() || switching) return
    switching = true
    try {
      const updated = await window.LiteConnect.switchAiModel(providerId, model)
      deps.replaceSettings(updated)
      if (!disposed) deps.applyExternal(updated)
    } catch (error: any) {
      if (!disposed) ElMessage.warning(error?.message || deps.t('ai.switchModelFailed'))
    } finally { switching = false }
  }

  function closeSettingsPanel() { settingsRequest++; showSettings.value = false }

  async function openSettingsPanel() {
    if (disposed) return
    const request = ++settingsRequest
    deps.closeHistory()
    showModelSwitcher.value = false
    try { await deps.refreshSettings() } catch (error: any) {
      if (!disposed) ElMessage.warning(error?.message || deps.t('ai.loadSettingsFailed'))
    }
    if (disposed || request !== settingsRequest || !deps.active()) return
    showSettings.value = true
    await nextTick()
    if (!disposed && request === settingsRequest) deps.applyExternal(deps.settings.value)
  }

  onScopeDispose(() => { disposed = true; settingsRequest++; cancelPositioning() })
  watch(deps.active, active => { if (!active) { settingsRequest++; closeModelSwitcher() } })
  return { showSettings, showModelSwitcher, modelSwitcherButtonRef, modelSwitcherDropdownRef,
    modelSwitcherStyle, modelSwitcherGroups, switchModel, openSettingsPanel, closeSettingsPanel,
    openModelSwitcher, closeModelSwitcher, toggleModelSwitcher, onModelMenuKeydown }
}
