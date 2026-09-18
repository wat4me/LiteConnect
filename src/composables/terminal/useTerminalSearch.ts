import { ref, nextTick } from 'vue'
import type { SearchAddon, ISearchOptions } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'

export function useTerminalSearch(deps: {
  getTerminal: () => Terminal | null
  getSearchAddon: () => SearchAddon | null
}) {
  const searchVisible = ref(false)
  const searchQuery = ref('')
  const caseSensitive = ref(false)
  const useRegex = ref(false)
  const matchIndex = ref(0)
  const matchCount = ref(0)
  let searchInputRef: HTMLInputElement | null = null
  let resultsDisposable: { dispose: () => void } | null = null

  function setSearchInputRef(el: HTMLInputElement | null) {
    searchInputRef = el
  }

  function decorations(): ISearchOptions['decorations'] {
    return {
      matchBackground: '#ffb80066',
      activeMatchBackground: '#ffb80099',
      matchBorder: '#ffb800',
      activeMatchBorder: '#ff8c00',
      matchOverviewRuler: '#ffb800',
      activeMatchColorOverviewRuler: '#ff8c00',
    }
  }

  function searchOptions(): ISearchOptions {
    return {
      caseSensitive: caseSensitive.value,
      regex: useRegex.value,
      decorations: decorations(),
    }
  }

  function clearMatchState() {
    matchIndex.value = 0
    matchCount.value = 0
  }

  /** Wire SearchAddon.onDidChangeResults once after addon is created. */
  function bindSearchAddon(addon: SearchAddon | null) {
    resultsDisposable?.dispose()
    resultsDisposable = null
    if (!addon?.onDidChangeResults) return
    resultsDisposable = addon.onDidChangeResults((e) => {
      if (!e || e.resultCount <= 0 || e.resultIndex < 0) {
        clearMatchState()
        return
      }
      matchCount.value = e.resultCount
      matchIndex.value = e.resultIndex + 1
    })
  }

  function disposeSearchListeners() {
    resultsDisposable?.dispose()
    resultsDisposable = null
  }

  function toggleSearch() {
    searchVisible.value = !searchVisible.value
    if (searchVisible.value) {
      searchQuery.value = ''
      clearMatchState()
      nextTick(() => {
        searchInputRef?.focus()
        searchInputRef?.select()
      })
    } else {
      deps.getSearchAddon()?.clearDecorations()
      clearMatchState()
      deps.getTerminal()?.focus()
    }
  }

  function doSearch(query: string, direction: 'next' | 'prev' = 'next') {
    const searchAddon = deps.getSearchAddon()
    if (!searchAddon || !query) {
      searchAddon?.clearDecorations()
      clearMatchState()
      return
    }
    const opts = searchOptions()
    const found =
      direction === 'prev'
        ? searchAddon.findPrevious(query, opts)
        : searchAddon.findNext(query, opts)
    if (!found) clearMatchState()
  }

  function onSearchInput() {
    doSearch(searchQuery.value, 'next')
  }

  function findNext() {
    doSearch(searchQuery.value, 'next')
  }

  function findPrevious() {
    doSearch(searchQuery.value, 'prev')
  }

  function onSearchKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (e.shiftKey) findPrevious()
      else findNext()
    } else if (e.key === 'Escape') {
      toggleSearch()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && !e.shiftKey) {
      e.preventDefault()
      findNext()
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && e.shiftKey) {
      e.preventDefault()
      findPrevious()
    }
  }

  function closeSearch() {
    if (searchVisible.value) {
      toggleSearch()
    }
  }

  function reRunSearch() {
    if (searchVisible.value && searchQuery.value) {
      doSearch(searchQuery.value, 'next')
    }
  }

  return {
    searchVisible,
    searchQuery,
    caseSensitive,
    useRegex,
    matchIndex,
    matchCount,
    setSearchInputRef,
    bindSearchAddon,
    disposeSearchListeners,
    toggleSearch,
    doSearch,
    findNext,
    findPrevious,
    onSearchInput,
    onSearchKeydown,
    closeSearch,
    reRunSearch,
  }
}
