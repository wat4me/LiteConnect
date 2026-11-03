import { onBeforeUnmount, onMounted, ref } from 'vue'
import { defaultWorkspaceLayout, normalizeWorkspaceLayout, type SshWorkspaceLayout } from '@shared/workspaceLayout'

/** One instance per window. Persistent placement is independent of live panel/session state. */
export function useWorkspaceLayout() {
  const layout = ref(defaultWorkspaceLayout()), ready = ref(false), error = ref(false), saving = ref(false)
  let alive = true, epoch = 0, pending: SshWorkspaceLayout | undefined, writing = false
  let unsubscribe: (() => void) | undefined
  async function flush() {
    if (writing) return
    writing = true; saving.value = true
    try {
      while (pending && alive) {
        const next = pending; pending = undefined
        const version = epoch
        try {
          const saved = await window.LiteConnect.setManySettings({ sshWorkspaceLayout: next })
          if (alive && version === epoch && !pending) { layout.value = normalizeWorkspaceLayout(saved.sshWorkspaceLayout); error.value = false }
        } catch {
          if (alive) error.value = true
        }
      }
    } finally { writing = false; if (alive) saving.value = false }
  }
  function update(next: SshWorkspaceLayout) {
    if (!ready.value) return
    epoch++; layout.value = normalizeWorkspaceLayout(next); pending = normalizeWorkspaceLayout(next)
    void flush()
  }
  async function load() {
    const version = epoch
    try {
      const saved = await window.LiteConnect.getAllSettings()
      if (alive && version === epoch) { layout.value = normalizeWorkspaceLayout(saved.sshWorkspaceLayout); ready.value = true; error.value = false }
    } catch { if (alive && version === epoch) error.value = true }
  }
  onMounted(() => {
    unsubscribe = window.LiteConnect.onSettingsChanged?.(({ settings, changed }) => {
      if (!changed.includes('sshWorkspaceLayout')) return
      epoch++; pending = undefined
      layout.value = normalizeWorkspaceLayout(settings.sshWorkspaceLayout); ready.value = true; error.value = false
    })
    void load()
  })
  onBeforeUnmount(() => { alive = false; unsubscribe?.() })
  return { layout, ready, error, saving, update, retry: () => ready.value ? update(layout.value) : void load() }
}
