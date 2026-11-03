import { ref, type Ref } from 'vue'
import type { WorkspacePanel } from '@shared/workspaceLayout'

/**
 * Default batch/snippet behavior remains exclusive; the workspace layout can
 * place them in separate regions. The shared panel policy handles other conflicts.
 */
export function useWorkspacePanels(monitorVisible: Ref<boolean>, canShowAlongside: (a: WorkspacePanel, b: WorkspacePanel) => boolean = () => false) {
  const batchPanelVisible = ref(false)
  const snippetsPanelVisible = ref(false)
  const batchInitialCommand = ref('')
  const snippetPaletteVisible = ref(false)
  const snippetDraftCommand = ref('')

  function toggleBatchPanel() {
    batchPanelVisible.value = !batchPanelVisible.value
    if (batchPanelVisible.value && !canShowAlongside('batch', 'snippets')) {
      snippetsPanelVisible.value = false
    }
  }

  function toggleSnippetsPanel() {
    snippetsPanelVisible.value = !snippetsPanelVisible.value
    if (snippetsPanelVisible.value && !canShowAlongside('snippets', 'batch')) {
      batchPanelVisible.value = false
    }
  }

  function openSnippetsPanelWithDraft(command: string) {
    snippetDraftCommand.value = command
    if (!canShowAlongside('snippets', 'batch')) batchPanelVisible.value = false
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
    monitorVisible.value = !monitorVisible.value
  }

  function openBatchWithCommand(command: string) {
    batchInitialCommand.value = command
    if (!canShowAlongside('batch', 'snippets')) snippetsPanelVisible.value = false
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
