import { describe, expect, it } from 'vitest'
import {
  applyFlagToSegment,
  applySuggestionToLine,
  buildShellSuggestions,
  extractSuggestPrefix,
  flagMatchesTypedArgs,
  isFlagSuggestMode,
  parseSuggestSegment,
  suggestCompletionSuffix,
} from './shellCommandSuggest'

describe('extractSuggestPrefix', () => {
  it('uses last pipeline segment', () => {
    expect(extractSuggestPrefix('ls | gr')).toBe('gr')
    expect(extractSuggestPrefix('echo a && ps')).toBe('ps')
  })
})

describe('parseSuggestSegment / isFlagSuggestMode', () => {
  it('detects flag mode after command + space', () => {
    expect(isFlagSuggestMode('ls ')).toBe(true)
    expect(isFlagSuggestMode('ls')).toBe(false)
    expect(isFlagSuggestMode('ls -')).toBe(true)
    expect(isFlagSuggestMode('xyz ')).toBe(false)
  })

  it('parses tokens', () => {
    expect(parseSuggestSegment('ls -a')).toEqual({
      raw: 'ls -a',
      tokens: ['ls', '-a'],
      endsWithSpace: false,
    })
  })
})

describe('buildShellSuggestions', () => {
  const history = [
    { command: 'ps aux | grep nginx', at: 300 },
    { command: 'ps -ef', at: 200 },
    { command: 'rm -rf /tmp/cache', at: 100 },
  ]

  it('puts history before builtins', () => {
    const items = buildShellSuggestions({
      query: 'ps',
      history,
      describe: () => 'list processes',
    })
    expect(items.length).toBeGreaterThan(0)
    expect(items[0].source).toBe('history')
    expect(items[0].command).toMatch(/^ps/)
    const builtin = items.find((x) => x.source === 'builtin' && x.command === 'ps')
    expect(builtin).toBeTruthy()
    expect(items.indexOf(items[0])).toBeLessThan(items.indexOf(builtin!))
  })

  it('keeps up to 5 history + 3 system (max 8)', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      command: `ls hist-${i}`,
      at: 1000 - i,
    }))
    const items = buildShellSuggestions({
      query: 'ls',
      history: many,
      describe: () => 'list',
    })
    const hist = items.filter((x) => x.source === 'history')
    const sys = items.filter((x) => x.source === 'builtin' || x.source === 'flag')
    expect(hist.length).toBe(5)
    expect(sys.length).toBeGreaterThanOrEqual(1)
    expect(sys.length).toBeLessThanOrEqual(3)
    expect(items.length).toBe(hist.length + sys.length)
    expect(items.length).toBeLessThanOrEqual(8)
    // newest first among history of equal score
    expect(hist[0].command).toBe('ls hist-0')
  })

  it('returns empty for blank query', () => {
    expect(buildShellSuggestions({ query: '  ', history })).toEqual([])
  })

  it('matches rm history and builtin', () => {
    const items = buildShellSuggestions({
      query: 'rm',
      history,
      describe: (k) => k,
    })
    expect(items.some((x) => x.source === 'history' && x.command.includes('rm'))).toBe(true)
    expect(items.some((x) => x.source === 'builtin' && x.command === 'rm')).toBe(true)
  })

  it('flag mode: title is flag only, command is full segment', () => {
    const items = buildShellSuggestions({
      query: 'ls ',
      history: [],
      describe: (k) => k,
    })
    const flags = items.filter((x) => x.source === 'flag')
    expect(flags.length).toBeGreaterThan(0)
    const a = flags.find((x) => x.title === '-a')
    expect(a).toBeTruthy()
    expect(a!.title).toBe('-a')
    expect(a!.command).toBe('ls -a')
    expect(a!.command.startsWith('ls ')).toBe(true)
  })

  it('flag mode: filters by partial flag', () => {
    const items = buildShellSuggestions({
      query: 'ls -l',
      history: [],
      describe: () => 'd',
    })
    const titles = items.filter((x) => x.source === 'flag').map((x) => x.title)
    // exact -l hidden; longer -lah / -lt still shown
    expect(titles).not.toContain('-l')
    expect(titles).toContain('-lah')
    expect(titles).toContain('-lt')
    expect(titles).not.toContain('-a')
  })

  it('docker ps exact: no sibling subcommands like exec', () => {
    const items = buildShellSuggestions({
      query: 'docker ps',
      history: [],
      describe: () => 'd',
    })
    const flags = items.filter((x) => x.source === 'flag')
    expect(flags.every((x) => x.title !== 'exec -it')).toBe(true)
    expect(flags.every((x) => x.title !== 'images')).toBe(true)
    // may still offer longer extension ps -a
    const titles = flags.map((x) => x.title)
    expect(titles.every((t) => t.startsWith('ps'))).toBe(true)
  })

  it('docker ps space: only extensions of ps, not exec', () => {
    const items = buildShellSuggestions({
      query: 'docker ps ',
      history: [],
      describe: () => 'd',
    })
    const titles = items.filter((x) => x.source === 'flag').map((x) => x.title)
    expect(titles).not.toContain('exec -it')
    expect(titles).not.toContain('ps')
    expect(titles).toContain('ps -a')
  })
})

describe('flagMatchesTypedArgs', () => {
  it('hides exact complete and siblings', () => {
    expect(flagMatchesTypedArgs('ps', 'ps', false)).toBe(false)
    expect(flagMatchesTypedArgs('ps -a', 'ps', false)).toBe(true)
    expect(flagMatchesTypedArgs('exec -it', 'ps', false)).toBe(false)
    expect(flagMatchesTypedArgs('ps -a', 'ps', true)).toBe(true)
    expect(flagMatchesTypedArgs('exec -it', 'ps', true)).toBe(false)
  })
})

describe('applyFlagToSegment', () => {
  it('appends after command space', () => {
    expect(applyFlagToSegment('ls ', '-a')).toBe('ls -a')
  })

  it('replaces partial last token', () => {
    expect(applyFlagToSegment('ls -', '-a')).toBe('ls -a')
    expect(applyFlagToSegment('ls -l', '-lah')).toBe('ls -lah')
  })

  it('replaces subcommand args instead of stacking', () => {
    expect(applyFlagToSegment('docker ps', 'ps -a')).toBe('docker ps -a')
    expect(applyFlagToSegment('docker ps ', 'ps -a')).toBe('docker ps -a')
    expect(applyFlagToSegment('docker p', 'ps')).toBe('docker ps')
  })
})

describe('suggestCompletionSuffix', () => {
  it('appends when prefix matches', () => {
    expect(suggestCompletionSuffix('ps', 'ps aux')).toEqual({ clearCount: 0, write: ' aux' })
  })

  it('replaces when not a prefix', () => {
    expect(suggestCompletionSuffix('ps a', 'rm -rf x')).toEqual({
      clearCount: 4,
      write: 'rm -rf x',
    })
  })

  it('appends flag after ls ', () => {
    expect(suggestCompletionSuffix('ls ', 'ls -a')).toEqual({ clearCount: 0, write: '-a' })
  })
})

describe('applySuggestionToLine', () => {
  it('replaces last segment after pipe', () => {
    expect(applySuggestionToLine('cat a | gr', 'grep foo')).toBe('cat a | grep foo')
  })
})
