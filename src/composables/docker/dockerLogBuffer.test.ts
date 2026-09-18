import { describe, expect, it } from 'vitest'
import type { DockerLogEntry } from '../../env.d'
import {
  appendDockerLogEntries,
  clearDockerLogRingBuffer,
  createDockerLogRingBuffer,
} from './dockerLogBuffer'

function e(seq: number, text: string): DockerLogEntry {
  return { sequence: seq, stream: 'stdout', timestamp: null, text }
}

describe('dockerLogBuffer', () => {
  it('evicts oldest by entry count', () => {
    let buf = createDockerLogRingBuffer()
    buf = appendDockerLogEntries(buf, [e(1, 'a'), e(2, 'b'), e(3, 'c')], 2, 1_000_000)
    expect(buf.entries.map((x) => x.sequence)).toEqual([2, 3])
    expect(buf.droppedCount).toBe(1)
  })

  it('evicts oldest by char budget', () => {
    let buf = createDockerLogRingBuffer()
    buf = appendDockerLogEntries(buf, [e(1, 'aaaa'), e(2, 'bbbb'), e(3, 'c')], 100, 6)
    expect(buf.entries.map((x) => x.text)).toEqual(['bbbb', 'c'])
    expect(buf.droppedCount).toBe(1)
  })

  it('clear resets entries and dropped count without second history', () => {
    let buf = createDockerLogRingBuffer()
    buf = appendDockerLogEntries(buf, [e(1, 'x')], 10, 100)
    buf = appendDockerLogEntries(buf, [e(2, 'y')], 1, 100)
    expect(buf.droppedCount).toBe(1)
    buf = clearDockerLogRingBuffer(buf)
    expect(buf.entries).toEqual([])
    expect(buf.droppedCount).toBe(0)
    expect(buf.totalChars).toBe(0)
  })
})
