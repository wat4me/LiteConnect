import { describe, expect, it } from 'vitest'
import {
  buildDbConnectionUrl,
  mapMysqlExtraOptions,
  mapOracleExtraOptions,
  mapPostgresExtraOptions,
  normalizeExtraOptions,
  parseDbConnectionUrl,
} from './dbConnectionUrl'

describe('parseDbConnectionUrl', () => {
  it('parses mysql URL with useSSL and timezone', () => {
    const p = parseDbConnectionUrl(
      'mysql://root@127.0.0.1:3306/app?useSSL=true&serverTimezone=UTC',
    )
    expect(p.engine).toBe('mysql')
    expect(p.host).toBe('127.0.0.1')
    expect(p.port).toBe(3306)
    expect(p.username).toBe('root')
    expect(p.database).toBe('app')
    expect(p.ssl).toBe(true)
    expect(p.extraOptions.serverTimezone).toBe('UTC')
  })

  it('parses jdbc mysql', () => {
    const p = parseDbConnectionUrl('jdbc:mysql://db:3307/x?allowPublicKeyRetrieval=true')
    expect(p.engine).toBe('mysql')
    expect(p.host).toBe('db')
    expect(p.port).toBe(3307)
    expect(p.extraOptions.allowPublicKeyRetrieval).toBe('true')
  })

  it('parses postgres sslmode', () => {
    const p = parseDbConnectionUrl('postgresql://u@h:5432/db?sslmode=require')
    expect(p.engine).toBe('postgres')
    expect(p.ssl).toBe(true)
    expect(p.extraOptions.sslmode).toBe('require')
  })

  it('parses oracle easy connect', () => {
    const p = parseDbConnectionUrl('db.example.com:1521/ORCLPDB1')
    expect(p.engine).toBe('oracle')
    expect(p.host).toBe('db.example.com')
    expect(p.port).toBe(1521)
    expect(p.database).toBe('ORCLPDB1')
  })

  it('parses oracle descriptor as connect string', () => {
    const desc = '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=h)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=X)))'
    const p = parseDbConnectionUrl(desc)
    expect(p.engine).toBe('oracle')
    expect(p.oracleConnectString).toBe(desc)
  })

  it('decodes encoded credentials and database names', () => {
    const p = parseDbConnectionUrl('mysql://first%20last:p%40ss@db.example.com:3306/app%20data')
    expect(p.username).toBe('first last')
    expect(p.password).toBe('p@ss')
    expect(p.database).toBe('app data')
  })

  it('parses JDBC Oracle thin connect strings', () => {
    const p = parseDbConnectionUrl('jdbc:oracle:thin:@db.example.com:1521/ORCL')
    expect(p.engine).toBe('oracle')
    expect(p.oracleConnectString).toBe('db.example.com:1521/ORCL')
  })
})

describe('buildDbConnectionUrl', () => {
  it('builds mysql without password', () => {
    const u = buildDbConnectionUrl({
      engine: 'mysql',
      host: 'localhost',
      port: 3306,
      database: 'app',
      username: 'root',
      ssl: true,
    })
    expect(u).toContain('mysql://')
    expect(u).toContain('useSSL=true')
    expect(u).not.toContain('password')
  })

  it('builds oracle easy connect', () => {
    expect(
      buildDbConnectionUrl({ engine: 'oracle', host: 'h', port: 1521, database: 'ORCL' }),
    ).toBe('h:1521/ORCL')
  })

  it('encodes URL parts and never includes a password option', () => {
    const url = buildDbConnectionUrl({
      engine: 'postgres',
      host: 'db.example.com',
      port: 5432,
      username: 'first last',
      database: 'app data',
      extraOptions: { password: 'secret', application_name: 'Lite Connect' },
    })
    expect(url).toBe('postgresql://first%20last@db.example.com:5432/app%20data?application_name=Lite+Connect')
    expect(url).not.toContain('secret')
  })
})

describe('map extra options', () => {
  it('maps mysql keys', () => {
    const m = mapMysqlExtraOptions({
      useSSL: 'true',
      allowPublicKeyRetrieval: 'true',
      serverTimezone: '+08:00',
      unknown: 'x',
    })
    expect(m.sslEnabled).toBe(true)
    expect(m.allowPublicKeyRetrieval).toBe(true)
    expect(m.timezone).toBe('+08:00')
    expect(m.unmapped).toContain('unknown')
  })

  it('maps postgres sslmode disable', () => {
    const m = mapPostgresExtraOptions({ sslmode: 'disable', connect_timeout: '5' })
    expect(m.sslEnabled).toBe(false)
    expect(m.connectionTimeoutMillis).toBe(5000)
  })

  it('maps oracle connectionString', () => {
    const m = mapOracleExtraOptions({ connectionString: 'h:1521/x', connectTimeout: '20' })
    expect(m.connectionString).toBe('h:1521/x')
    expect(m.connectTimeout).toBe(20)
  })

  it('normalizes options by dropping invalid values and limiting key count', () => {
    expect(normalizeExtraOptions({ keep: ' yes ', empty: ' ', nil: null, '\0bad': 'x' })).toEqual({
      keep: 'yes',
    })
    expect(normalizeExtraOptions({ one: '1', two: '2' }, 1)).toEqual({ one: '1' })
  })
})
