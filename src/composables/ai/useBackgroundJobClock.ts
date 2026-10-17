import { onScopeDispose, ref, watch } from 'vue'

/** One local clock per visible task panel; no IPC polling or per-job timers. */
export function useBackgroundJobClock(active: () => boolean) {
  const now = ref(Date.now())
  let timer: ReturnType<typeof setInterval> | undefined
  const stop = () => { if (timer != null) clearInterval(timer); timer = undefined }
  watch(active, running => {
    stop()
    now.value = Date.now()
    if (running) timer = setInterval(() => { now.value = Date.now() }, 1000)
  }, { immediate: true, flush: 'sync' })
  onScopeDispose(stop)
  return now
}
