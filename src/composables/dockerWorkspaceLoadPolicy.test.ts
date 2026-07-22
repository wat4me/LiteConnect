import { describe, expect, it, vi } from 'vitest'
import {
  countListLoadsForReconnect,
  onDockerAvailabilityKeyChange,
  onDockerSshReconnected,
} from './dockerWorkspaceLoadPolicy'

describe('dockerWorkspaceLoadPolicy', () => {
  it('reconnect only probes and never calls refreshList', () => {
    const probe = vi.fn()
    const refreshList = vi.fn()
    onDockerSshReconnected({ probe, refreshList })
    expect(probe).toHaveBeenCalledTimes(1)
    expect(refreshList).not.toHaveBeenCalled()
  })

  it('availability key change loads list once per new key', () => {
    const loadList = vi.fn()
    onDockerAvailabilityKeyChange('s1:available', null, loadList)
    onDockerAvailabilityKeyChange('s1:available', 's1:available', loadList)
    onDockerAvailabilityKeyChange(null, 's1:available', loadList)
    onDockerAvailabilityKeyChange('s1:available', null, loadList)
    expect(loadList).toHaveBeenCalledTimes(2)
  })

  it('one reconnect then available loads list exactly once', () => {
    expect(countListLoadsForReconnect(['reconnect', 'available'])).toBe(1)
  })

  it('double reconnect with available each time loads twice total (once per available)', () => {
    expect(
      countListLoadsForReconnect(['reconnect', 'available', 'reconnect', 'available']),
    ).toBe(2)
  })
})
