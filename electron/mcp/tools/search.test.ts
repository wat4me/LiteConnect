import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  buildFindFilesCommand,
  buildGlobCommand,
  buildGrepCommand,
  buildTailGrepCommand,
  countGrepHits,
  includeBasename,
  isGrepGroupSeparator,
  parseGrepLine,
  parseGrepOutput,
  sanitizeContextLines,
  sanitizeIncludeGlob,
  sanitizeSearchPattern,
  sanitizeTailBytes,
} from './search'

describe('search helpers', () => {
  it('quotes rg/grep commands and keeps a simple include glob', () => {
    expect(buildGrepCommand({ engine: 'rg', pattern: 'error', path: '/var/log', include: '*.log' })).toContain(
      "rg -n -H --no-heading",
    )
    expect(buildGrepCommand({ engine: 'grep', pattern: "it's", path: '/etc' })).toContain("'\\''")
    expect(buildGlobCommand({ engine: 'rg', path: '/etc', pattern: '*.conf' })).toContain('rg --files')
    expect(buildGlobCommand({ engine: 'find', path: '/etc', pattern: '*.conf' })).toContain('find')
  })

  it('parses rg -H lines and caps match count', () => {
    expect(parseGrepLine('/var/log/app.log:12:disk full')).toEqual({
      path: '/var/log/app.log',
      line: 12,
      text: 'disk full',
    })
    const rows = Array.from({ length: 120 }, (_, i) => `/tmp/a:${i + 1}:x`).join('\n')
    expect(parseGrepOutput(rows)).toHaveLength(100)
  })

  it('rejects empty or multiline patterns', () => {
    expect(() => sanitizeSearchPattern('')).toThrow(/pattern is required/)
    expect(() => sanitizeSearchPattern('a\nb')).toThrow(/single line/)
    expect(sanitizeIncludeGlob('**/*.log')).toBe('**/*.log')
    expect(() => sanitizeIncludeGlob('*.log; rm -rf /')).toThrow(/simple glob/)
  })
})

describe('context lines', () => {
  it('adds -C to rg and grep only when asked', () => {
    expect(buildGrepCommand({ engine: 'rg', pattern: 'x', path: '/tmp' })).not.toContain('-C')
    expect(buildGrepCommand({ engine: 'rg', pattern: 'x', path: '/tmp', contextLines: 3 })).toContain('-C 3')
    expect(buildGrepCommand({ engine: 'grep', pattern: 'x', path: '/tmp', contextLines: 3 })).toContain('-C 3')
  })

  it('marks context rows and skips the -- group separator', () => {
    expect(parseGrepLine('/var/log/a.log:11-before')).toEqual({
      path: '/var/log/a.log',
      line: 11,
      text: 'before',
      context: true,
    })
    expect(isGrepGroupSeparator('--')).toBe(true)
    expect(isGrepGroupSeparator('/var/log/a.log:11-x')).toBe(false)

    const matches = parseGrepOutput(
      ['/var/log/a.log:11-before', '/var/log/a.log:12:disk full', '--', '/var/log/a.log:13-after'].join('\n'),
    )
    expect(matches.map((m) => [m.line, m.context === true])).toEqual([
      [11, true],
      [12, false],
      [13, true],
    ])
    expect(countGrepHits(matches)).toBe(1)
  })

  it('spends the hit budget on matches, not on context', () => {
    const rows: string[] = []
    for (let i = 1; i <= 130; i++) {
      rows.push(`/tmp/a.log:${i}-ctx`)
      rows.push(`/tmp/a.log:${i}:hit`)
    }
    const matches = parseGrepOutput(rows.join('\n'))
    expect(countGrepHits(matches)).toBe(100)
    expect(matches.length).toBeGreaterThan(100)
  })

  it('clamps contextLines and tailBytes into their ranges', () => {
    expect(sanitizeContextLines(undefined)).toBe(0)
    expect(sanitizeContextLines('4')).toBe(4)
    expect(sanitizeContextLines(999)).toBe(10)
    expect(() => sanitizeContextLines(-1)).toThrow(/contextLines/)
    expect(sanitizeTailBytes(0)).toBe(0)
    expect(sanitizeTailBytes(2048)).toBe(2048)
    expect(() => sanitizeTailBytes('abc')).toThrow(/tailBytes/)
  })
})

describe('tail window search', () => {
  it('reduces a nested glob to a find -name basename', () => {
    expect(includeBasename('**/*.log')).toBe('*.log')
    expect(includeBasename('*.conf')).toBe('*.conf')
    expect(buildFindFilesCommand({ path: '/var/log', include: '**/*.log' })).toBe(
      "find '/var/log' -type f -name '*.log' | head -n 20",
    )
  })

  it('builds one grep per file and shifts line numbers back to absolute', () => {
    const cmd = buildTailGrepCommand({
      files: ['/var/log/app.log', "/var/log/my app.log"],
      pattern: "it's down",
      tailBytes: 65536,
      contextLines: 2,
    })
    expect(cmd).toContain("for f in '/var/log/app.log' '/var/log/my app.log'; do")
    expect(cmd).toContain('tail -c 65536 "$f"')
    expect(cmd).toContain('grep -n -C 2 --')
    // Real line count, not newline count: a final line without a trailing
    // newline would otherwise shift every reported line number down by one.
    expect(cmd).toContain('total=$(grep -c \'\' "$f")')
    expect(cmd).not.toContain('wc -l <')
    // Offset = totalLines - windowLines, floored at 0.
    expect(cmd).toContain('off=$((total - n)); [ "$off" -lt 0 ] && off=0;')
    // awk rewrites both `12:text` (hit) and `12-text` (context), and passes the
    // group separator through untouched so the parser can drop it.
    expect(cmd).toContain('/^--$/ { print "--"; next }')
    // Statements must be `;`-separated: the fragments are joined with spaces, so
    // dropping a `;` produces a valid-looking string that awk rejects at runtime.
    expect(cmd).toContain('{ i = index($1, "-");')
    expect(cmd).toContain('else { $1 = f ":" $1 } } 1\'')
    expect(cmd).toContain('awk -F: -v f="$f" -v o="$off"')
  })

  it('reads awk output through the normal parser', () => {
    const stdout = ['/var/log/app.log:1204-ctx', '/var/log/app.log:1205:disk full', '/var/log/app.log:1206-ctx'].join(
      '\n',
    )
    const matches = parseGrepOutput(stdout)
    expect(countGrepHits(matches)).toBe(1)
    expect(matches[1]).toEqual({ path: '/var/log/app.log', line: 1205, text: 'disk full' })
  })
})

/**
 * The string assertions above cannot catch a shell/awk syntax error — only
 * running the generated command can. Skipped when no bash is on PATH.
 */
function bashAvailable(): boolean {
  try {
    execSync('bash --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const describeShell = bashAvailable() ? describe : describe.skip

describeShell('buildTailGrepCommand (executed in bash)', () => {
  let dir = ''

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'litegrep-'))
    // 20 filler lines, HIT-A on 21, three middle lines, HIT-B on 25.
    const body = `${Array.from({ length: 20 }, (_, i) => `filler ${i + 1}`).join('\n')}\nHIT-A\nx1\nx2\nx3\nHIT-B`
    writeFileSync(join(dir, 'with-newline.log'), `${body}\n`, 'utf8')
    writeFileSync(join(dir, 'no-newline.log'), body, 'utf8')
  })

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  it('reports absolute line numbers for both trailing-newline styles', () => {
    const cmd = buildTailGrepCommand({
      files: ['with-newline.log', 'no-newline.log'],
      pattern: 'HIT-',
      tailBytes: 120,
      contextLines: 1,
    })
    writeFileSync(join(dir, 'run.sh'), `${cmd}\n`, 'utf8')
    const stdout = execSync('bash run.sh', { cwd: dir, encoding: 'utf8' })
    const matches = parseGrepOutput(stdout).filter((m) => !m.context)

    // wc -l would undercount `no-newline.log` by one and shift every line down.
    expect(matches).toEqual([
      { path: 'with-newline.log', line: 21, text: 'HIT-A' },
      { path: 'with-newline.log', line: 25, text: 'HIT-B' },
      { path: 'no-newline.log', line: 21, text: 'HIT-A' },
      { path: 'no-newline.log', line: 25, text: 'HIT-B' },
    ])
  })
})
