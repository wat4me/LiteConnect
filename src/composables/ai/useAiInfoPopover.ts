import { onBeforeUnmount, onDeactivated, ref, type Ref } from 'vue'
import { useOutsideDismiss } from '@/composables/shared/useOutsideDismiss'

/** Hover previews the statistics; clicking keeps them open for inspection. */
export function useAiInfoPopover(trigger: Ref<HTMLElement | null>, detail: Ref<HTMLElement | null>) {
  const open = ref(false)
  let pinned = false
  let restoreFocus = false
  let hideTimer: ReturnType<typeof setTimeout> | undefined
  function clearHideTimer() { clearTimeout(hideTimer) }
  function show() {
    clearHideTimer()
    restoreFocus = false
    open.value = true
  }
  function close() {
    clearHideTimer()
    restoreFocus = document.activeElement === trigger.value || !!detail.value?.contains(document.activeElement)
    pinned = false
    open.value = false
  }
  function hideLater() {
    clearHideTimer()
    if (!pinned) hideTimer = setTimeout(close, 180)
  }
  function afterHide() {
    // Preserve keyboard position if removing the popover releases focus to body.
    if (!open.value && restoreFocus && document.activeElement === document.body) trigger.value?.focus({ preventScroll: true })
    restoreFocus = false
  }
  function toggle() {
    if (pinned) close()
    else { pinned = true; show() }
  }
  useOutsideDismiss(open, close, () => [trigger.value, detail.value])
  onDeactivated(close)
  onBeforeUnmount(clearHideTimer)
  return { open, show, close, toggle, hideLater, clearHideTimer, afterHide }
}
