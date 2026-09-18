/**
 * Connection URL parse/build + advanced option whitelist (Beekeeper-style).
 * Not a full JDBC Properties layer — maps known keys to Node driver options.
 */

export type DbUrlEngine = 'mysql' | 'postgres' | 'oracle'

export type ParsedDbUrl = {
  engine?: DbUrlEngine
  host?: string
  port?: number
  username?: string
  password?: string
  database?: string
  /** Query / advanced options (string values) */
  extraOptions: Record<string, string>
  /** SSL inferred from URL (useSSL, sslmode, …) */
  ssl?: boolean
  /** Oracle: full connect string when not Easy Connect host:port/svc */
  oracleConnectString?: string
  warnings: string[]
}

/** Known advanced option keys per engine (UI presets + apply whitelist). */
export const ADVANCED_OPTION_KEYS: Record<
  DbUrlEngine,
  Array<{ key: string; label: string; hint?: string }>
> = {
  mysql: [
    { key: 'useSSL', label: 'useSSL', hint: 'true/false → SSL' },
    { key: 'allowPublicKeyRetrieval', label: 'allowPublicKeyRetrieval' },
    { key: 'serverTimezone', label: 'serverTimezone', hint: 'e.g. +08:00 / UTC' },
    { key: 'connectTimeout', label: 'connectTimeout', hint: 'ms' },
    { key: 'dateStrings', label: 'dateStrings', hint: 'true/false' },
    { key: 'charset', label: 'charset', hint: 'e.g. utf8mb4' },
  ],
  postgres: [
    { key: 'sslmode', label: 'sslmode', hint: 'disable|require|prefer|verify-ca|verify-full' },
    { key: 'connect_timeout', label: 'connect_timeout', hint: 'seconds' },
    { key: 'application_name', label: 'application_name' },
    { key: 'options', label: 'options', hint: 'libpq -c flags (limited)' },
  ],
  oracle: [
    { key: 'connectionString', label: 'connectionString', hint: 'Easy Connect / descriptor' },
    { key: 'connectTimeout', label: 'connectTimeout', hint: 'seconds (Thin)' },
  ],
}

export function normalizeExtraOptions(
  raw: unknown,
  maxKeys = 32,
): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k || '').trim()
    if (!key || key.length > 64) continue
    if (v == null) continue
    const val = String(v).trim()
    if (!val || val.length > 2000) continue
    if (val.includes('\0') || key.includes('\0')) continue
    out[key] = val
    if (Object.keys(out).length >= maxKeys) break
  }
  return Object.keys(out).length ? out : undefined
}

function truthy(v: string | undefined): boolean {
  if (v == null) return false
  const s = v.trim().toLowerCase()
  return s === '1' || s === 'true' || s === 'yes' || s === 'on' || s === 'require'
}

function falsy(v: string | undefined): boolean {
  if (v == null) return false
  const s = v.trim().toLowerCase()
  return s === '0' || s === 'false' || s === 'no' || s === 'off' || s === 'disable'
}

/**
 * Parse mysql://, postgres(ql)://, jdbc:mysql://, jdbc:postgresql://,
 * jdbc:oracle:thin:@…, or Oracle Easy Connect host:port/service.
 */
export function parseDbConnectionUrl(raw: string, hintEngine?: DbUrlEngine): ParsedDbUrl {
  const warnings: string[] = []
  const text = String(raw || '').trim()
  if (!text) return { extraOptions: {}, warnings: ['empty'] }

  // Oracle descriptor / full connect string
  if (text.startsWith('(') || (text.includes('DESCRIPTION') && text.includes('='))) {
    return {
      engine: 'oracle',
      extraOptions: { connectionString: text },
      oracleConnectString: text,
      database: text,
      warnings,
    }
  }

  let s = text
  // Strip jdbc: prefix variants
  if (/^jdbc:mysql:/i.test(s)) {
    s = s.replace(/^jdbc:mysql:/i, 'mysql:')
  } else if (/^jdbc:mariadb:/i.test(s)) {
    s = s.replace(/^jdbc:mariadb:/i, 'mysql:')
  } else if (/^jdbc:postgresql:/i.test(s)) {
    s = s.replace(/^jdbc:postgresql:/i, 'postgresql:')
  } else if (/^jdbc:oracle:thin:@\/\//i.test(s)) {
    // jdbc:oracle:thin:@//host:port/service
    s = s.replace(/^jdbc:oracle:thin:@\/\//i, 'oracle://')
  } else if (/^jdbc:oracle:thin:@/i.test(s)) {
    const rest = s.replace(/^jdbc:oracle:thin:@/i, '').trim()
    return {
      engine: 'oracle',
      extraOptions: { connectionString: rest },
      oracleConnectString: rest,
      database: rest,
      warnings,
    }
  }

  // Bare Easy Connect: host:port/service (no scheme)
  let forcedOracleEasy = false
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(s) && /^[^/\s]+:\d{1,5}\//.test(s)) {
    s = `oracle://${s}`
    forcedOracleEasy = true
  }

  // Ensure parseable URL (mysql:// → use http parser trick if needed)
  let urlStr = s
  if (/^mysql:\/\//i.test(urlStr)) {
    urlStr = urlStr.replace(/^mysql:\/\//i, 'http://')
  } else if (/^mariadb:\/\//i.test(urlStr)) {
    urlStr = urlStr.replace(/^mariadb:\/\//i, 'http://')
  } else if (/^postgres(ql)?:\/\//i.test(urlStr)) {
    urlStr = urlStr.replace(/^postgres(ql)?:\/\//i, 'http://')
  } else if (/^oracle:\/\//i.test(urlStr)) {
    urlStr = urlStr.replace(/^oracle:\/\//i, 'http://')
  }

  let u: URL
  try {
    u = new URL(urlStr)
  } catch {
    // last resort: treat as oracle connect string
    if (hintEngine === 'oracle' || /[:/=]/.test(text)) {
      return {
        engine: 'oracle',
        extraOptions: { connectionString: text },
        oracleConnectString: text,
        database: text,
        warnings: [...warnings, 'parsed_as_oracle_connect_string'],
      }
    }
    return { extraOptions: {}, warnings: ['invalid_url'] }
  }

  let engine: DbUrlEngine | undefined = hintEngine
  if (forcedOracleEasy || /^oracle:|^jdbc:oracle/i.test(text) || /^oracle:\/\//i.test(s)) {
    engine = 'oracle'
  } else if (/^mysql:|^mariadb:|^jdbc:mysql/i.test(text)) {
    engine = 'mysql'
  } else if (/^postgres|^jdbc:postgres/i.test(text)) {
    engine = 'postgres'
  } else if (!engine) {
    engine = hintEngine
  }

  const host = u.hostname || undefined
  const port = u.port ? Number(u.port) : undefined
  const username = u.username ? decodeURIComponent(u.username) : undefined
  const password = u.password ? decodeURIComponent(u.password) : undefined
  let database = u.pathname ? decodeURIComponent(u.pathname.replace(/^\//, '')) : undefined
  if (database === '') database = undefined

  const extraOptions: Record<string, string> = {}
  u.searchParams.forEach((value, key) => {
    if (key) extraOptions[key] = value
  })

  let ssl: boolean | undefined
  if (truthy(extraOptions.useSSL) || truthy(extraOptions.useSsl) || truthy(extraOptions.ssl)) {
    ssl = true
  }
  if (falsy(extraOptions.useSSL) || falsy(extraOptions.useSsl) || falsy(extraOptions.ssl)) {
    ssl = false
  }
  const sslmode = (extraOptions.sslmode || '').toLowerCase()
  if (sslmode) {
    if (sslmode === 'disable') ssl = false
    else if (['require', 'prefer', 'verify-ca', 'verify-full', 'allow'].includes(sslmode)) {
      ssl = sslmode !== 'prefer' ? true : true
    }
  }

  // Flag unknown keys for UI (still stored — apply layer drops unsupported)
  if (engine) {
    const known = new Set(ADVANCED_OPTION_KEYS[engine].map((k) => k.key.toLowerCase()))
    known.add('usessl')
    known.add('ssl')
    known.add('sslmode')
    for (const k of Object.keys(extraOptions)) {
      if (!known.has(k.toLowerCase())) {
        warnings.push(`unmapped:${k}`)
      }
    }
  }

  return {
    engine,
    host,
    port: port && Number.isFinite(port) ? port : undefined,
    username,
    password,
    database,
    extraOptions,
    ssl,
    warnings,
  }
}

export type BuildUrlInput = {
  engine: DbUrlEngine
  host: string
  port: number
  database?: string
  username?: string
  ssl?: boolean
  extraOptions?: Record<string, string>
}

/** Build a driver-friendly URL (not JDBC). Password never included. */
export function buildDbConnectionUrl(input: BuildUrlInput): string {
  const host = (input.host || 'localhost').trim() || 'localhost'
  const port = input.port || (input.engine === 'postgres' ? 5432 : input.engine === 'oracle' ? 1521 : 3306)
  const db = (input.database || '').trim()
  const params = new URLSearchParams()

  if (input.engine === 'oracle') {
    if (db.includes('=') || db.startsWith('(') || db.includes('://')) {
      return db
    }
    const svc = db || 'ORCL'
    return `${host}:${port}/${svc}`
  }

  const scheme = input.engine === 'postgres' ? 'postgresql' : 'mysql'
  const user = input.username?.trim()
  const auth = user ? `${encodeURIComponent(user)}@` : ''
  const path = db ? `/${encodeURIComponent(db)}` : ''

  const extras = { ...(input.extraOptions || {}) }
  if (input.engine === 'mysql') {
    if (input.ssl && extras.useSSL == null) params.set('useSSL', 'true')
  }
  if (input.engine === 'postgres') {
    if (input.ssl && extras.sslmode == null) params.set('sslmode', 'require')
  }
  for (const [k, v] of Object.entries(extras)) {
    if (k === 'password' || k === 'pwd') continue
    if (v != null && String(v).trim()) params.set(k, String(v))
  }
  const q = params.toString()
  return `${scheme}://${auth}${host}:${port}${path}${q ? `?${q}` : ''}`
}

/** Options applied when creating mysql2 pool/connection. */
export type MysqlDriverExtras = {
  sslEnabled?: boolean
  allowPublicKeyRetrieval?: boolean
  timezone?: string
  connectTimeout?: number
  dateStrings?: boolean
  charset?: string
  unmapped: string[]
}

export function mapMysqlExtraOptions(
  extra?: Record<string, string> | null,
): MysqlDriverExtras {
  const unmapped: string[] = []
  const out: MysqlDriverExtras = { unmapped }
  if (!extra) return out
  for (const [rawKey, rawVal] of Object.entries(extra)) {
    const key = rawKey.trim()
    const val = String(rawVal)
    const kl = key.toLowerCase()
    if (kl === 'usessl' || kl === 'ssl') {
      if (truthy(val)) out.sslEnabled = true
      else if (falsy(val)) out.sslEnabled = false
      continue
    }
    if (kl === 'allowpublickeyretrieval') {
      out.allowPublicKeyRetrieval = truthy(val)
      continue
    }
    if (kl === 'servertimezone' || kl === 'timezone') {
      out.timezone = val
      continue
    }
    if (kl === 'connecttimeout') {
      const n = Number(val)
      if (Number.isFinite(n) && n > 0) out.connectTimeout = Math.floor(n)
      continue
    }
    if (kl === 'datestrings') {
      out.dateStrings = truthy(val)
      continue
    }
    if (kl === 'charset') {
      out.charset = val
      continue
    }
    unmapped.push(key)
  }
  return out
}

export type PostgresDriverExtras = {
  sslEnabled?: boolean
  connectionTimeoutMillis?: number
  application_name?: string
  unmapped: string[]
}

export function mapPostgresExtraOptions(
  extra?: Record<string, string> | null,
): PostgresDriverExtras {
  const unmapped: string[] = []
  const out: PostgresDriverExtras = { unmapped }
  if (!extra) return out
  for (const [rawKey, rawVal] of Object.entries(extra)) {
    const key = rawKey.trim()
    const val = String(rawVal)
    const kl = key.toLowerCase()
    if (kl === 'sslmode' || kl === 'ssl') {
      const mode = val.toLowerCase()
      if (mode === 'disable' || falsy(val)) out.sslEnabled = false
      else out.sslEnabled = true
      continue
    }
    if (kl === 'connect_timeout' || kl === 'connectiontimeoutmillis') {
      const n = Number(val)
      if (Number.isFinite(n) && n > 0) {
        // connect_timeout is seconds in libpq; connectionTimeoutMillis is ms
        out.connectionTimeoutMillis =
          kl === 'connect_timeout' ? Math.floor(n * 1000) : Math.floor(n)
      }
      continue
    }
    if (kl === 'application_name') {
      out.application_name = val
      continue
    }
    if (kl === 'options') {
      // skip free-form libpq options for safety
      unmapped.push(key)
      continue
    }
    unmapped.push(key)
  }
  return out
}

export type OracleDriverExtras = {
  connectionString?: string
  connectTimeout?: number
  unmapped: string[]
}

export function mapOracleExtraOptions(
  extra?: Record<string, string> | null,
): OracleDriverExtras {
  const unmapped: string[] = []
  const out: OracleDriverExtras = { unmapped }
  if (!extra) return out
  for (const [rawKey, rawVal] of Object.entries(extra)) {
    const key = rawKey.trim()
    const val = String(rawVal)
    const kl = key.toLowerCase()
    if (kl === 'connectionstring' || kl === 'connectstring') {
      out.connectionString = val
      continue
    }
    if (kl === 'connecttimeout') {
      const n = Number(val)
      if (Number.isFinite(n) && n > 0) out.connectTimeout = Math.floor(n)
      continue
    }
    unmapped.push(key)
  }
  return out
}
