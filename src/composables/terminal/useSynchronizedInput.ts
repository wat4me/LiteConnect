import { computed, ref, shallowReactive, type InjectionKey } from 'vue'

export function createSynchronizedInput() {
  const enabled = ref(false)
  const selected = ref<string[]>([])
  const terminals = shallowReactive(new Map<string, { writable: () => boolean; receive: (data: string) => void }>())
  let forwarding = false
  const available = (id: string) => terminals.get(id)?.writable() === true
  const targets = computed(() => selected.value.filter(available))
  function stop() { enabled.value = false }
  function removeTarget(id: string) {
    selected.value = selected.value.filter(value => value !== id)
    if (targets.value.length < 2) stop()
  }
  function select(ids: string[]) {
    // Changing recipients always pauses broadcasting until explicitly enabled again.
    stop()
    selected.value = [...new Set(ids)].filter(available)
  }
  function start() { enabled.value = targets.value.length >= 2; return enabled.value }
  function register(id: string, terminal: { writable: () => boolean; receive: (data: string) => void }) {
    terminals.set(id, terminal)
    return () => {
      if (terminals.get(id) !== terminal) return
      terminals.delete(id)
      removeTarget(id)
    }
  }
  function forward(source: string, data: string) {
    if (forwarding || !enabled.value || !data || !available(source) || !targets.value.includes(source)) return
    // Terminal status/focus reports are responses to remote queries, not user input.
    if (/^\x1b\[(?:[?>=]?[\d;]*[cnR]|[IO])$/.test(data) || /^\x1b[\]P]/.test(data)) return
    if (targets.value.length < 2) { stop(); return }
    forwarding = true
    try {
      for (const id of [...targets.value]) {
        if (id !== source && enabled.value && available(id)) {
          try { terminals.get(id)?.receive(data) }
          catch (error) { removeTarget(id); stop(); console.warn('Synchronized input target failed:', error); break }
        }
      }
    } finally { forwarding = false }
  }
  return { enabled, selected, targets, available, start, stop, select, register, removeTarget, forward }
}
export type SynchronizedInput = ReturnType<typeof createSynchronizedInput>
export const synchronizedInputKey: InjectionKey<SynchronizedInput> = Symbol('synchronized-input')
