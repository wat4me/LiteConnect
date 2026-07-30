/**
 * Pure UI state for the global "confirm dangerous SQL" setting.
 * Single source of truth remains electron settings store via IPC —
 * this only models load/save honesty in the query settings popover.
 */

export type GlobalDangerousSqlUiState = {
  /** Last known persisted value when known=true */
  value: boolean
  /** True only after a successful load or successful save */
  known: boolean
  loading: boolean
  saving: boolean
  /** User-visible load/save error; empty when ok */
  error: string
}

export function initialGlobalDangerousSqlUi(
  fallback = true,
): GlobalDangerousSqlUiState {
  return {
    value: fallback,
    known: false,
    loading: false,
    saving: false,
    error: '',
  }
}

/** Begin async load — UI must not claim value is authoritative yet. */
export function beginLoadGlobalDangerousSql(
  prev: GlobalDangerousSqlUiState,
): GlobalDangerousSqlUiState {
  return { ...prev, loading: true, error: '' }
}

/**
 * Apply load result. On failure, keep previous known value (if any) and surface error;
 * never flip known to true on failure.
 */
export function applyLoadGlobalDangerousSql(
  prev: GlobalDangerousSqlUiState,
  result: { ok: true; value: boolean } | { ok: false; error: string },
): GlobalDangerousSqlUiState {
  if (result.ok) {
    return {
      value: result.value !== false,
      known: true,
      loading: false,
      saving: false,
      error: '',
    }
  }
  return {
    ...prev,
    loading: false,
    error: result.error || 'load failed',
  }
}

export function beginSaveGlobalDangerousSql(
  prev: GlobalDangerousSqlUiState,
  nextValue: boolean,
): GlobalDangerousSqlUiState {
  return {
    ...prev,
    value: nextValue !== false,
    saving: true,
    error: '',
  }
}

/**
 * Apply save result. On failure, revert to previousValue and show error —
 * UI must not claim the toggle stuck if persistence failed.
 */
export function applySaveGlobalDangerousSql(
  prev: GlobalDangerousSqlUiState,
  result:
    | { ok: true; value: boolean }
    | { ok: false; error: string; previousValue: boolean },
): GlobalDangerousSqlUiState {
  if (result.ok) {
    return {
      value: result.value !== false,
      known: true,
      loading: false,
      saving: false,
      error: '',
    }
  }
  return {
    ...prev,
    value: result.previousValue !== false,
    known: prev.known,
    loading: false,
    saving: false,
    error: result.error || 'save failed',
  }
}

/** Whether the checkbox may be toggled (loaded and not mid flight). */
export function canToggleGlobalDangerousSql(state: GlobalDangerousSqlUiState): boolean {
  return state.known && !state.loading && !state.saving
}
