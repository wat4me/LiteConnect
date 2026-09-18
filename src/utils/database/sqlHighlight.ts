/** Escape HTML for safe injection into highlight layer */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const SQL_KEYWORDS = new Set(
  [
    'ADD', 'ALL', 'ALTER', 'ANALYZE', 'AND', 'AS', 'ASC', 'BETWEEN', 'BY', 'CASE',
    'CAST', 'CHANGE', 'CHARACTER', 'CHECK', 'COLLATE', 'COLUMN', 'CONSTRAINT',
    'CREATE', 'CROSS', 'CURRENT_DATE', 'CURRENT_TIME', 'CURRENT_TIMESTAMP',
    'DATABASE', 'DEFAULT', 'DELETE', 'DESC', 'DESCRIBE', 'DISTINCT', 'DROP',
    'ELSE', 'END', 'ESCAPE', 'EXISTS', 'EXPLAIN', 'FALSE', 'FOREIGN', 'FROM',
    'FULL', 'GROUP', 'HAVING', 'IF', 'IGNORE', 'IN', 'INDEX', 'INNER', 'INSERT',
    'INTO', 'IS', 'JOIN', 'KEY', 'LEFT', 'LIKE', 'LIMIT', 'LOCK', 'NATURAL',
    'NOT', 'NULL', 'OFFSET', 'ON', 'OR', 'ORDER', 'OUTER', 'PRIMARY', 'PROCEDURE',
    'REFERENCES', 'REGEXP', 'RENAME', 'REPLACE', 'RIGHT', 'RLIKE', 'SELECT',
    'SET', 'SHOW', 'STRAIGHT_JOIN', 'TABLE', 'THEN', 'TO', 'TRUE', 'TRUNCATE',
    'UNION', 'UNIQUE', 'UNLOCK', 'UPDATE', 'USE', 'USING', 'VALUES', 'VIEW',
    'WHEN', 'WHERE', 'WITH', 'XOR',
  ].map((k) => k.toLowerCase()),
)

/**
 * Lightweight SQL syntax highlighter for overlay editors.
 * Returns HTML with spans; input is treated as plain text (escaped).
 */
export function highlightSql(sql: string): string {
  if (!sql) return '\n'
  let i = 0
  const n = sql.length
  let out = ''

  while (i < n) {
    const ch = sql[i]

    // Line comment --
    if (ch === '-' && sql[i + 1] === '-') {
      let j = i + 2
      while (j < n && sql[j] !== '\n') j += 1
      out += `<span class="sql-cmt">${esc(sql.slice(i, j))}</span>`
      i = j
      continue
    }

    // Block comment /* */
    if (ch === '/' && sql[i + 1] === '*') {
      let j = i + 2
      while (j < n && !(sql[j] === '*' && sql[j + 1] === '/')) j += 1
      j = Math.min(n, j + 2)
      out += `<span class="sql-cmt">${esc(sql.slice(i, j))}</span>`
      i = j
      continue
    }

    // Single-quoted string
    if (ch === "'") {
      let j = i + 1
      while (j < n) {
        if (sql[j] === '\\' && j + 1 < n) {
          j += 2
          continue
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2
            continue
          }
          j += 1
          break
        }
        j += 1
      }
      out += `<span class="sql-str">${esc(sql.slice(i, j))}</span>`
      i = j
      continue
    }

    // Double-quoted string / identifier
    if (ch === '"') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === '\\' && j + 1 < n) {
          j += 2
          continue
        }
        if (sql[j] === '"') {
          j += 1
          break
        }
        j += 1
      }
      out += `<span class="sql-str">${esc(sql.slice(i, j))}</span>`
      i = j
      continue
    }

    // Backtick identifier
    if (ch === '`') {
      let j = i + 1
      while (j < n) {
        if (sql[j] === '`' && sql[j + 1] === '`') {
          j += 2
          continue
        }
        if (sql[j] === '`') {
          j += 1
          break
        }
        j += 1
      }
      out += `<span class="sql-ident">${esc(sql.slice(i, j))}</span>`
      i = j
      continue
    }

    // Number
    if (/[0-9]/.test(ch) || (ch === '.' && i + 1 < n && /[0-9]/.test(sql[i + 1]))) {
      let j = i
      while (j < n && /[0-9eE.+-]/.test(sql[j])) j += 1
      out += `<span class="sql-num">${esc(sql.slice(i, j))}</span>`
      i = j
      continue
    }

    // Word (keyword or plain)
    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j += 1
      const word = sql.slice(i, j)
      if (SQL_KEYWORDS.has(word.toLowerCase())) {
        out += `<span class="sql-kw">${esc(word)}</span>`
      } else {
        out += esc(word)
      }
      i = j
      continue
    }

    out += esc(ch)
    i += 1
  }

  // Trailing newline keeps last line height in pre aligned with textarea
  if (!out.endsWith('\n')) out += '\n'
  return out
}
