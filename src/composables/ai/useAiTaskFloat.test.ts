import { effectScope, nextTick, ref, type EffectScope } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useAiTaskFloat } from './useAiTaskFloat'

let scope: EffectScope | undefined

afterEach(() => {
  scope?.stop()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function setup(initiallyPending = true) {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class {
    constructor(private readonly measure: () => void) {}
    observe() { this.measure() }
    disconnect() {}
  })
  vi.stubGlobal('document', { addEventListener() {}, removeEventListener() {} })
  const active = ref(true)
  const pending = ref(initiallyPending)
  scope = effectScope()
  const float = scope.run(() => useAiTaskFloat(() => active.value, () => 'ssh', () => pending.value))!
  float.surface.value = { clientWidth: 400, clientHeight: 300 } as HTMLElement
  await nextTick()
  return { float, active, pending }
}

function pointer(clientX = 0, clientY = 0) {
  return { isPrimary: true, button: 0, pointerId: 1, clientX, clientY } as PointerEvent
}

async function advance(ms: number) {
  await nextTick()
  vi.advanceTimersByTime(ms)
  await nextTick()
}

it('tucks to the nearest edge after 10 idle seconds and restores the free position for new work', async () => {
  const { float, pending } = await setup()
  float.pointerDown(pointer())
  float.pointerMove(pointer(-190, -210))
  float.pointerUp(pointer())
  await advance(30_000)
  expect(float.triggerStyle.value).toEqual({ left: '170px', top: '50px' })
  expect(float.tucked.value).toBe(false)

  pending.value = false
  await advance(9999)
  expect(float.tucked.value).toBe(false)
  await advance(1)
  expect(float.tucked.value).toBe(true)
  expect(float.edge.value).toBe('top')

  pending.value = true
  await nextTick()
  expect(float.tucked.value).toBe(false)
  expect(float.triggerStyle.value).toEqual({ left: '170px', top: '50px' })
})

it('keeps a manual tuck during work and leaves old results at their saved position', async () => {
  const { float, pending } = await setup(false)
  await advance(15_000)
  expect(float.tucked.value).toBe(false)

  pending.value = true
  await nextTick()
  float.pointerDown(pointer())
  float.pointerMove(pointer(-360, -100))
  float.pointerUp(pointer())
  await advance(15_000)
  expect(float.tucked.value).toBe(true)
  expect(float.edge.value).toBe('left')
})

it('restarts the idle wait after hover, viewing tasks, pointer release, and focus', async () => {
  const { float, pending } = await setup()
  pending.value = false
  await advance(9000)
  float.setHovered(true)
  await advance(15_000)
  expect(float.tucked.value).toBe(false)

  float.setHovered(false)
  float.expanded.value = true
  await advance(15_000)
  expect(float.tucked.value).toBe(false)

  float.close()
  float.pointerDown(pointer())
  await advance(15_000)
  expect(float.tucked.value).toBe(false)

  float.pointerUp(pointer())
  await advance(9000)
  float.onTriggerFocus()
  await advance(9999)
  expect(float.tucked.value).toBe(false)
  await advance(1)
  expect(float.tucked.value).toBe(true)
})

it('cancels the idle wait on new work and starts a fresh wait when the session returns', async () => {
  const { float, active, pending } = await setup()
  pending.value = false
  await advance(9000)
  pending.value = true
  await advance(15_000)
  expect(float.tucked.value).toBe(false)

  pending.value = false
  await advance(9000)
  active.value = false
  await advance(15_000)
  expect(float.tucked.value).toBe(false)
  active.value = true
  await advance(9999)
  expect(float.tucked.value).toBe(false)
  await advance(1)
  expect(float.tucked.value).toBe(true)
})
