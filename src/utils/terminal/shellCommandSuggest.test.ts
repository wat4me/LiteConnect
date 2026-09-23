import { describe, expect, it } from 'vitest'
import {
  applyFlagToSegment,
  applySuggestionToLine,
  buildCdBookmarkSuggestions,
  buildShellSuggestions,
  cdBookmarkCommand,
  extractSuggestPrefix,
  flagMatchesTypedArgs,
  isFlagSuggestMode,
  nextShellSuggestIndex,
  parseSuggestSegment,
  shellSuggestNavigationDirection,
  suggestCompletionSuffix,
} from './shellCommandSuggest'

describe('nextShellSuggestIndex', () => {
  it('selects A on the first ArrowDown from the neutral state', () => {
    expect(nextShellSuggestIndex(-1, 3, 1)).toBe(0)
  })

  it('selects the last item on the first ArrowUp and wraps afterwards', () => {
    expect(nextShellSuggestIndex(-1, 3, -1)).toBe(2)
    expect(nextShellSuggestIndex(2, 3, 1)).toBe(0)
    expect(nextShellSuggestIndex(0, 3, -1)).toBe(2)
  })

  it('keeps an empty list unselected', () => {
    expect(nextShellSuggestIndex(-1, 0, 1)).toBe(-1)
  })
})

describe('shellSuggestNavigationDirection', () => {
  it('handles one physical ArrowDown exactly once across xterm key phases', () => {
    const phases = [
      { type: 'keydown', key: 'ArrowDown' },
      { type: 'keyup', key: 'ArrowDown' },
    ]
    let index = -1
    for (const event of phases) {
      const direction = shellSuggestNavigationDirection(event)
      if (direction != null) index = nextShellSuggestIndex(index, 3, direction)
    }
    expect(index).toBe(0)
  })

  it('ignores keyup and non-navigation keys', () => {
    expect(shellSuggestNavigationDirection({ type: 'keyup', key: 'ArrowUp' })).toBeNull()
    expect(shellSuggestNavigationDirection({ type: 'keydown', key: 'Enter' })).toBeNull()
  })
})

describe('extractSuggestPrefix', () => {
  it('uses last pipeline segment', () => {
    expect(extractSuggestPrefix('ls | gr')).toBe('gr')
    expect(extractSuggestPrefix('echo a && ps')).toBe('ps')
  })
})

describe('parseSuggestSegment / isFlagSuggestMode', () => {
  it('detects flag mode for a complete known command', () => {
    expect(isFlagSuggestMode('ls ')).toBe(true)
    expect(isFlagSuggestMode('ls')).toBe(true)
    expect(isFlagSuggestMode('ls -')).toBe(true)
    expect(isFlagSuggestMode('docker')).toBe(true)
    expect(isFlagSuggestMode('dock')).toBe(false)
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

  it('bare exact command: offers matching full history lines', () => {
    const items = buildShellSuggestions({
      query: 'ps',
      history,
      describe: () => 'list processes',
    })
    expect(items.some((x) => x.source === 'history' && x.command === 'ps -ef')).toBe(true)
  })

  it('does not offer static command-name suggestions', () => {
    const items = buildShellSuggestions({
      query: 'net',
      history: [],
      describe: () => '',
    })
    expect(items).toEqual([])
  })

  it('offers Docker presets on a fresh connection without history or a trailing space', () => {
    const items = buildShellSuggestions({ query: 'docker', history: [] })
    expect(items.some((item) => item.source === 'flag' && item.command === 'docker logs')).toBe(true)
    expect(items.some((item) => item.source === 'flag' && item.command === 'docker images')).toBe(true)
  })

  it('partial bare name still matches longer history first-token', () => {
    const items = buildShellSuggestions({
      query: 'doc',
      history: [
        { command: 'docker ps', at: 10 },
        { command: 'docker compose up', at: 9 },
      ],
      describe: () => '',
    })
    const hist = items.filter((x) => x.source === 'history')
    expect(hist.some((x) => x.command.startsWith('docker'))).toBe(true)
  })

  it('after space, history of full lines is available again', () => {
    const items = buildShellSuggestions({
      query: 'docker p',
      history: [
        { command: 'docker ps', at: 10 },
        { command: 'docker compose up', at: 9 },
      ],
      describe: () => '',
    })
    expect(items.some((x) => x.source === 'history' && x.command === 'docker ps')).toBe(true)
  })

  it('does not suggest other commands just because their paths contain the typed command', () => {
    const history = [
      { command: 'docker ps', at: 3 },
      { command: 'vim /home/buildfile/dockerfile', at: 2 },
      { command: 'cat /home/buildfile/dockerfile', at: 1 },
    ]
    for (const query of ['docker', 'docker ']) {
      const items = buildShellSuggestions({ query, history })
      expect(items.filter((item) => item.source === 'history').map((item) => item.command)).toEqual([
        'docker ps',
      ])
    }
  })

  it('keeps up to 5 history when completing past bare name', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      command: `ls hist-${i}`,
      at: 1000 - i,
    }))
    const items = buildShellSuggestions({
      query: 'ls h',
      history: many,
      describe: () => 'list',
    })
    const hist = items.filter((x) => x.source === 'history')
    expect(hist.length).toBe(5)
    expect(items.length).toBe(hist.length)
    expect(items.length).toBeLessThanOrEqual(5)
    expect(hist[0].command).toBe('ls hist-0')
  })

  it('returns empty for blank query', () => {
    expect(buildShellSuggestions({ query: '  ', history })).toEqual([])
  })

  it('bare exact rm: offers full matching history', () => {
    const items = buildShellSuggestions({
      query: 'rm',
      history,
      describe: (k) => k,
    })
    expect(items.some((x) => x.source === 'history' && x.command === 'rm -rf /tmp/cache')).toBe(true)
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

describe('cd bookmark suggestions', () => {
  const bookmarks = [
    { name: '站点', path: '/home/v5-automation-servers' },
    { name: '日志', path: '/var/log' },
    { name: '同样', path: '/var/log' },
    { name: '文档', path: '/home/文档' },
  ]

  it('offers bookmarked directories when the user types cd', () => {
    const items = buildCdBookmarkSuggestions('cd', bookmarks)
    expect(items.map((item) => item.command)).toEqual([
      'cd /home/v5-automation-servers',
      'cd /var/log',
      "cd '/home/文档'",
    ])
    expect(items[0]).toMatchObject({
      source: 'bookmark',
      title: '/home/v5-automation-servers',
      subtitle: '站点',
    })
    expect(cdBookmarkCommand('/home/文档')).toBe("cd '/home/文档'")
  })

  it('keeps only paths that continue the typed prefix and hides a finished path', () => {
    expect(buildCdBookmarkSuggestions('cd /var', bookmarks).map((item) => item.command)).toEqual([
      'cd /var/log',
    ])
    expect(buildCdBookmarkSuggestions('cd /var/log', bookmarks)).toEqual([])
    expect(buildCdBookmarkSuggestions('cd "/home/v5', bookmarks).map((item) => item.title)).toEqual(['/home/v5-automation-servers'])
  })

  it('does not repeat the path when a bookmark has no custom name', () => {
    expect(buildCdBookmarkSuggestions('cd', [{ name: '', path: '/home/user' }])[0]).toMatchObject({
      title: '/home/user',
      subtitle: undefined,
    })
  })

  it('ignores other commands and stays inside the shell suggestion list', () => {
    expect(buildCdBookmarkSuggestions('ls', bookmarks)).toEqual([])
    const items = buildShellSuggestions({
      query: 'cd /home',
      history: [
        { command: 'cd /home/v5-automation-servers', at: 3 },
        { command: 'cd /home/other', at: 2 },
        { command: 'cd /tmp', at: 1 },
      ],
      bookmarks,
    })
    expect(items[0]).toMatchObject({
      source: 'bookmark',
      title: '/home/v5-automation-servers',
      subtitle: '站点',
    })
    expect(items.filter((item) => item.command === 'cd /home/v5-automation-servers')).toHaveLength(1)
    expect(items.some((item) => item.source === 'history' && item.command === 'cd /home/other')).toBe(true)
    expect(items.some((item) => item.command === 'cd /tmp')).toBe(false)
    expect(buildShellSuggestions({ query: 'ps', history: [], bookmarks }).every(
      (item) => item.source === 'flag',
    )).toBe(true)
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
