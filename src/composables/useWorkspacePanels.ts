import { ref, type Ref } from 'vue'

/**
 * Mutually exclusive right-side workspace panels (batch / snippets / monitor).
 */
export function useWorkspacePanels(monitorVisible: Ref<boolean>) {
  const batchPanelVisible = ref(false)
  const snippetsPanelVisible = ref(false)
  const batchInitialCommand = ref('')
  const snippetPaletteVisible = ref(false)
  const snippetDraftCommand = ref('')

  function toggleBatchPanel() {
    batchPanelVisible.value = !batchPanelVisible.value
    if (batchPanelVisible.value) {
      snippetsPanelVisible.value = false
      monitorVisible.value = false
    }
  }

  function toggleSnippetsPanel() {
    snippetsPanelVisible.value = !snippetsPanelVisible.value
    if (snippetsPanelVisible.value) {
      batchPanelVisible.value = false
      monitorVisible.value = false
    }
  }

  function openSnippetsPanelWithDraft(command: string) {
    snippetDraftCommand.value = command
    batchPanelVisible.value = false
    monitorVisible.value = false
    snippetsPanelVisible.value = true
  }

  function clearSnippetDraftCommand() {
    snippetDraftCommand.value = ''
  }

  function toggleSnippetPalette() {
    snippetPaletteVisible.value = !snippetPaletteVisible.value
  }

  function openSnippetPalette() {
    snippetPaletteVisible.value = true
  }

  function closeSnippetPalette() {
    snippetPaletteVisible.value = false
  }

  function toggleMonitorPanel() {
    if (monitorVisible.value) {
      monitorVisible.value = false
      return
    }
    snippetsPanelVisible.value = false
    batchPanelVisible.value = false
    monitorVisible.value = true
  }

  function openBatchWithCommand(command: string) {
    batchInitialCommand.value = command
    snippetsPanelVisible.value = false
    monitorVisible.value = false
    batchPanelVisible.value = true
  }

  function clearBatchInitialCommand() {
    batchInitialCommand.value = ''
  }

  return {
    batchPanelVisible,
    snippetsPanelVisible,
    batchInitialCommand,
    snippetPaletteVisible,
    snippetDraftCommand,
    toggleBatchPanel,
    toggleSnippetsPanel,
    openSnippetsPanelWithDraft,
    clearSnippetDraftCommand,
    toggleSnippetPalette,
    openSnippetPalette,
    closeSnippetPalette,
    toggleMonitorPanel,
    openBatchWithCommand,
    clearBatchInitialCommand,
  }
}
