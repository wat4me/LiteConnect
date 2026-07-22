/**
 * Renderer-side SQL risk assessment (mirrors electron/db/sqlRisk for offline UI).
 * Prefer window.LiteConnect.dbAssessSqlRisk when available; this is the pure helper + tests.
 */

export type SqlRiskLevel = 'none' | 'high' | 'uncertain'

export type SqlRiskKind =
  | 'drop'
  | 'truncate'
  | 'update_no_where'
  | 'delete_no_where'
  | 'multi_statement'
  | 'uncertain'

export type SqlRiskAssessment = {
  level: SqlRiskLevel
  kinds: SqlRiskKind[]
  reasons: string[]
  uncertain: boolean
}

type Token = { type: 'word' | 'punct' | 'other'; value: string }

export function stripSqlLiteralsAndComments(sql: string): {
  code: string
  uncertain: boolean
} {
  let out = ''
  let i = 0
  let uncertain = false
  const s = String(sql || '')
  const n = s.length

  while (i < n) {
    const c = s[i]
    const next = i + 1 < n ? s[i + 1] : ''

    if (c === '-' && next === '-') {
      i += 2
      while (i < n && s[i] !== '\n' && s[i] !== '\r') i++
      out += ' '
      continue
    }
    if (c === '#') {
      i++
      while (i < n && s[i] !== '\n' && s[i] !== '\r') i++
      out += ' '
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      let closed = false
      while (i < n) {
        if (s[i] === '*' && i + 1 < n && s[i + 1] === '/') {
          i += 2
          closed = true
          break
        }
        i++
      }
      if (!closed) uncertain = true
      out += ' '
      continue
    }
    if (c === "'") {
      i++
      let closed = false
      while (i < n) {
        if (s[i] === "'" && i + 1 < n && s[i + 1] === "'") {
          i += 2
          continue
        }
        if (s[i] === '\\' && i + 1 < n) {
          i += 2
          continue
        }
        if (s[i] === "'") {
          i++
          closed = true
          break
        }
        i++
      }
      if (!closed) uncertain = true
      out += " '' "
      continue
    }
    if (c === '"') {
      i++
      let closed = false
      while (i < n) {
        if (s[i] === '"' && i + 1 < n && s[i + 1] === '"') {
          i += 2
          continue
        }
        if (s[i] === '"') {
          i++
          closed = true
          break
        }
        i++
      }
      if (!closed) uncertain = true
      out += ' "" '
      continue
    }
    if (c === '`') {
      i++
      let closed = false
      while (i < n) {
        if (s[i] === '`' && i + 1 < n && s[i + 1] === '`') {
          i += 2
          continue
        }
        if (s[i] === '`') {
          i++
          closed = true
          break
        }
        i++
      }
      if (!closed) uncertain = true
      out += ' `` '
      continue
    }
    if (c === '$') {
      const tagMatch = s.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/)
      if (tagMatch) {
        const tag = tagMatch[0]
        i += tag.length
        const end = s.indexOf(tag, i)
        if (end < 0) {
          uncertain = true
          out += ' $$ '
          break
        }
        i = end + tag.length
        out += ' $$ '
        continue
      }
    }

    out += c
    i++
  }

  return { code: out, uncertain }
}

function tokenizeCode(code: string): Token[] {
  const tokens: Token[] = []
  const re = /[A-Za-z_][A-Za-z0-9_]*|[;()]|./g
  let m: RegExpExecArray | null
  while ((m = re.exec(code)) !== null) {
    const v = m[0]
    if (/^\s+$/.test(v)) continue
    if (/^[A-Za-z_]/.test(v)) tokens.push({ type: 'word', value: v.toUpperCase() })
    else if (v === ';' || v === '(' || v === ')') tokens.push({ type: 'punct', value: v })
    else tokens.push({ type: 'other', value: v })
  }
  return tokens
}

function splitStatements(tokens: Token[]): Token[][] {
  const stmts: Token[][] = []
  let cur: Token[] = []
  let depth = 0
  for (const t of tokens) {
    if (t.type === 'punct' && t.value === '(') depth++
    if (t.type === 'punct' && t.value === ')') depth = Math.max(0, depth - 1)
    if (t.type === 'punct' && t.value === ';' && depth === 0) {
      if (cur.length) stmts.push(cur)
      cur = []
      continue
    }
    cur.push(t)
  }
  if (cur.length) stmts.push(cur)
  return stmts
}

function wordsOf(stmt: Token[]): string[] {
  return stmt.filter((t) => t.type === 'word').map((t) => t.value)
}

function assessStatement(words: string[]): { kinds: SqlRiskKind[]; reasons: string[] } {
  const kinds: SqlRiskKind[] = []
  const reasons: string[] = []
  if (!words.length) return { kinds, reasons }

  let start = 0
  if (words[0] === 'WITH') {
    const mutating = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'CREATE', 'ALTER', 'REPLACE']
    const mutIdx = words.findIndex((w, i) => i > 0 && mutating.includes(w))
    if (mutIdx >= 0) {
      start = mutIdx
    } else {
      const dml = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'DROP', 'TRUNCATE', 'CREATE', 'ALTER', 'REPLACE']
      const idx = words.findIndex((w, i) => i > 0 && dml.includes(w))
      if (idx >= 0) start = idx
    }
  }

  const head = words[start]
  const rest = words.slice(start)

  if (head === 'DROP') {
    kinds.push('drop')
    reasons.push('DROP')
  }
  if (head === 'TRUNCATE') {
    kinds.push('truncate')
    reasons.push('TRUNCATE')
  }
  if (head === 'UPDATE' && !rest.includes('WHERE')) {
    kinds.push('update_no_where')
    reasons.push('UPDATE without WHERE')
  }
  if (head === 'DELETE' && !rest.includes('WHERE')) {
    kinds.push('delete_no_where')
    reasons.push('DELETE without WHERE')
  }

  return { kinds, reasons }
}

export function assessSqlRisk(sql: string): SqlRiskAssessment {
  const trimmed = String(sql || '').trim()
  if (!trimmed) {
    return { level: 'none', kinds: [], reasons: [], uncertain: false }
  }

  const { code, uncertain } = stripSqlLiteralsAndComments(trimmed)
  const tokens = tokenizeCode(code)
  const stmts = splitStatements(tokens)

  const kinds: SqlRiskKind[] = []
  const reasons: string[] = []

  if (stmts.length > 1) {
    kinds.push('multi_statement')
    reasons.push('multiple statements')
  }

  for (const stmt of stmts) {
    const a = assessStatement(wordsOf(stmt))
    for (const k of a.kinds) {
      if (!kinds.includes(k)) kinds.push(k)
    }
    for (const r of a.reasons) {
      if (!reasons.includes(r)) reasons.push(r)
    }
  }

  if (uncertain) {
    if (!kinds.includes('uncertain')) kinds.push('uncertain')
    if (!reasons.includes('unclosed string or comment')) {
      reasons.push('unclosed string or comment')
    }
  }

  const highKinds: SqlRiskKind[] = ['drop', 'truncate', 'update_no_where', 'delete_no_where']
  const hasHigh = kinds.some((k) => highKinds.includes(k))

  let level: SqlRiskLevel = 'none'
  if (hasHigh) level = 'high'
  else if (uncertain) level = 'uncertain'

  return { level, kinds, reasons, uncertain }
}

export function shouldConfirmSqlRisk(assessment: SqlRiskAssessment): boolean {
  return assessment.level === 'high' || assessment.level === 'uncertain'
}
