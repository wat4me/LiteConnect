import { describe, expect, it } from 'vitest'
import { buildOracleConnectString } from './oracle'

describe('buildOracleConnectString', () => {
  it('builds Easy Connect from host/port/serviceName', () => {
    expect(buildOracleConnectString('db.example.com', 1521, 'ORCL')).toBe(
      'db.example.com:1521/ORCL',
    )
  })

  it('allows empty service (host:port only)', () => {
    expect(buildOracleConnectString('127.0.0.1', 1521, '')).toBe('127.0.0.1:1521')
  })

  it('passes through full connect descriptor', () => {
    const desc = '(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=h)(PORT=1521))(CONNECT_DATA=(SERVICE_NAME=XEPDB1)))'
    expect(buildOracleConnectString('ignored', 9999, desc)).toBe(desc)
  })

  it('passes through key=value connect string', () => {
    expect(buildOracleConnectString('h', 1521, 'host=h port=1521 service_name=ORCL')).toBe(
      'host=h port=1521 service_name=ORCL',
    )
  })

  it('defaults port when invalid', () => {
    expect(buildOracleConnectString('localhost', 0, 'XEPDB1')).toBe('localhost:1521/XEPDB1')
  })
})
