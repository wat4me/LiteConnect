import { computed, ref, watch } from 'vue'

const STORAGE_KEY = 'LiteConnect.aiWorkspace.railCollapsed'

/** An explicit user choice wins over the narrow-chat default. */
export function useAiWorkspaceRail(chatVisible: () => boolean) {
  const workspaceElement = ref<HTMLElement | null>(null)
  const width = ref(Number.POSITIVE_INFINITY)
  const preference = ref<boolean | null>(readPreference())
  function readPreference() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved === 'true' ? true : saved === 'false' ? false : null
    } catch { return null }
  }
  watch(workspaceElement, (element, _previous, onCleanup) => {
    if (!element || typeof ResizeObserver === 'undefined') return
    width.value = element.getBoundingClientRect().width
    const observer = new ResizeObserver(entries => {
      if (entries[0]) width.value = entries[0].contentRect.width
    })
    observer.observe(element)
    onCleanup(() => observer.disconnect())
  }, { flush: 'post' })
  const railCollapsed = computed({
    get: () => preference.value ?? (chatVisible() && width.value <= 760),
    set: (value: boolean) => {
      preference.value = value
      try { localStorage.setItem(STORAGE_KEY, String(value)) }
      catch { /* The explicit choice still lasts for this workspace. */ }
    },
  })
  return { workspaceElement, railCollapsed }
}
