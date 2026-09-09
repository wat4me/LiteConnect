/** Coalesce stream changes without postponing writes on every token. */
export function createAssistantCheckpoint(save: () => Promise<void>, intervalMs = 1200) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined
  let dirty = false
  let urgent = false
  let stopped = false

  function write() {
    dirty = false
    urgent = false
    const task = Promise.resolve().then(save).catch((err) => {
      console.warn('Failed to checkpoint AI reply:', err)
    }).finally(() => {
      inFlight = undefined
      arm()
    })
    inFlight = task
    return task
  }

  function arm() {
    if (stopped || !dirty || timer !== undefined || inFlight) return
    timer = setTimeout(() => {
      timer = undefined
      void write()
    }, urgent ? 0 : intervalMs)
  }

  function schedule(immediate = false) {
    if (stopped) return
    dirty = true
    urgent ||= immediate
    if (immediate && timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    arm()
  }

  /** Save a tool boundary before remote work starts, independent of the renderer. */
  async function flush() {
    if (inFlight) await inFlight
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    if (!stopped && dirty) await write()
  }

  /** Stop intermediate writes and drain the current one before the final save. */
  async function stop() {
    stopped = true
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    await inFlight?.catch(() => undefined)
  }

  return { schedule, flush, stop }
}
