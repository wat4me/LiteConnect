import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, watchEffect } from 'vue'
import * as formatting from '@shared/aiToolRunDisplay'
import { createToolRunDisplayCache, TOOL_ARGS_MAX_CHARS, TOOL_DISPLAY_MAX_CHARS } from './toolRunDisplayCache'

afterEach(() => vi.restoreAllMocks())

describe('tool run display cache', () => {
  it('does not parse oversized payloads and bounds their rendered previews', () => {
    const displaySpy = vi.spyOn(formatting, 'formatToolRunDisplay')
    const argsSpy = vi.spyOn(formatting, 'formatToolRunArgs')
    const cache = createToolRunDisplayCache()
    const run = {
      name: 'exec',
      args: JSON.stringify({ command: 'x'.repeat(100_000) }),
      content: JSON.stringify({ stdout: 'x'.repeat(1_000_000), exitCode: 0 }),
    }
    expect(cache.toolView(run).body.length).toBeLessThanOrEqual(TOOL_DISPLAY_MAX_CHARS + 2)
    expect(cache.toolArgsText(run).length).toBeLessThanOrEqual(TOOL_ARGS_MAX_CHARS + 2)
    expect(displaySpy).not.toHaveBeenCalled()
    expect(argsSpy).not.toHaveBeenCalled()
    Object.assign(run, { args: '{}', content: '{"stdout":"ready","exitCode":0}' })
    expect(cache.toolView(run).body).toBe('ready')
    expect(displaySpy).toHaveBeenCalledTimes(1)
  })

  it('bounds error labels as well as expanded output', () => {
    const cache = createToolRunDisplayCache()
    const view = cache.toolView({ name: 'exec', content: 'x'.repeat(10_000), isError: true })
    expect(view.summary.kind).toBe('text')
    if (view.summary.kind === 'text') expect(view.summary.text.length).toBeLessThanOrEqual(302)
  })

  it('formats eight unchanged cards only once across repeated stream renders', () => {
    const displaySpy = vi.spyOn(formatting, 'formatToolRunDisplay')
    const argsSpy = vi.spyOn(formatting, 'formatToolRunArgs')
    const cache = createToolRunDisplayCache()
    const runs = Array.from({ length: 8 }, (_, id) => reactive({
      name: 'exec', args: JSON.stringify({ command: `echo ${id}` }),
      content: JSON.stringify({ stdout: 'output', exitCode: 0 }), status: 'done',
    }))
    for (let render = 0; render < 100; render++) {
      for (const run of runs) {
        for (let use = 0; use < 8; use++) cache.toolView(run)
        cache.toolArgsText(run)
        cache.toolArgsText(run)
      }
    }
    expect(displaySpy).toHaveBeenCalledTimes(8)
    expect(argsSpy).toHaveBeenCalledTimes(8)
    runs[0].status = 'running'
    cache.toolView(runs[0])
    expect(displaySpy).toHaveBeenCalledTimes(8)
  })

  it('invalidates display fields and accepts empty args and output', () => {
    const cache = createToolRunDisplayCache()
    const run = { name: 'exec', args: '{"command":"ls"}', content: 'ok', isError: false }
    let previous = cache.toolView(run)
    for (const patch of [
      { content: 'no' }, { args: '{"command":"pwd"}' },
      { isError: true }, { name: 'list_dir' }, { args: '', content: '' },
    ]) {
      Object.assign(run, patch)
      const view = cache.toolView(run)
      expect(view).not.toBe(previous)
      expect(view).toEqual(formatting.formatToolRunDisplay(run))
      expect(cache.toolArgsText(run)).toBe(formatting.formatToolRunArgs(run.args))
      previous = view
    }
  })

  it('keeps reactive dependencies on cache hits and subsequent in-place updates', async () => {
    const cache = createToolRunDisplayCache()
    const run = reactive({ name: 'exec', args: '{"command":"ls"}', content: 'first' })
    cache.toolView(run)
    cache.toolArgsText(run)
    let body = ''
    let args = ''
    const stop = watchEffect(() => {
      body = cache.toolView(run).body
      args = cache.toolArgsText(run)
    })
    try {
      for (const content of ['second', 'third']) {
        Object.assign(run, { content, args: JSON.stringify({ command: content }) })
        await nextTick()
        expect(body).toBe(content)
        expect(args).toContain(content)
      }
    } finally {
      stop()
    }
  })
})
