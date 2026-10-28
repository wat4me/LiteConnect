import { ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useBatchTest } from './useBatchTest'

vi.mock('vue', async importOriginal => ({
  ...await importOriginal<typeof import('vue')>(), onBeforeUnmount: () => {},
}))

describe('stable connection test status', () => {
  it('reuses the idle status across rows and unrelated list updates', () => {
    const api = useBatchTest(ref([]))
    const idle = api.getTestStatus('one')
    expect(api.getTestStatus('two')).toBe(idle)
    api.testStatuses.value.set('three', { state: 'testing' })
    expect(api.getTestStatus('one')).toBe(idle)
    expect(api.getTestStatus('three').state).toBe('testing')
    expect(Object.isFrozen(idle)).toBe(true)
  })
})
