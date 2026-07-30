import { describe, expect, it } from 'vitest'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  createTempExportFile,
  formatCsvCell,
  formatCsvHeader,
  formatCsvRow,
  formatJsonlRow,
  openExportWriteStream,
} from './exportWriter'

describe('formatCsvCell', () => {
  it('empty for null', () => {
    expect(formatCsvCell(null)).toBe('')
    expect(formatCsvCell(undefined)).toBe('')
  })

  it('quotes commas and newlines', () => {
    expect(formatCsvCell('a,b')).toBe('"a,b"')
    expect(formatCsvCell('a\nb')).toBe('"a\nb"')
    expect(formatCsvCell('say "hi"')).toBe('"say ""hi"""')
  })

  it('stringifies BigInt and Date', () => {
    expect(formatCsvCell(10n)).toBe('10')
    expect(formatCsvCell(new Date('2020-01-02T00:00:00.000Z'))).toBe('2020-01-02T00:00:00.000Z')
  })
})

describe('formatCsvRow / jsonl', () => {
  it('builds header and row', () => {
    expect(formatCsvHeader(['id', 'name'])).toBe('id,name\n')
    expect(formatCsvRow(['id', 'name'], { id: 1, name: 'a,b' })).toBe('1,"a,b"\n')
  })

  it('jsonl one object per line', () => {
    const line = formatJsonlRow(['id', 'name'], { id: 1n as any, name: null })
    expect(line.endsWith('\n')).toBe(true)
    const obj = JSON.parse(line)
    expect(obj).toEqual({ id: '1', name: null })
  })
})

describe('ExportWriteHandle lifecycle', () => {
  it('end then finalize leaves final file', async () => {
    const dir = await fsp.mkdtemp(join(tmpdir(), 'litesh-ew-'))
    const finalPath = join(dir, 'ok.csv')
    const temp = await createTempExportFile(finalPath)
    const w = openExportWriteStream(temp.tempPath)
    w.stream.write('a,b\n')
    await w.end()
    expect(w.isClosed()).toBe(true)
    await temp.finalize()
    const body = await fsp.readFile(finalPath, 'utf8')
    expect(body).toBe('a,b\n')
    await fsp.unlink(finalPath).catch(() => {})
    await fsp.rmdir(dir).catch(() => {})
  })

  it('destroy then cleanup removes temp (no open handle)', async () => {
    const dir = await fsp.mkdtemp(join(tmpdir(), 'litesh-ew2-'))
    const finalPath = join(dir, 'nope.csv')
    const temp = await createTempExportFile(finalPath)
    const w = openExportWriteStream(temp.tempPath)
    w.stream.write('partial')
    await w.destroy()
    await temp.cleanup()
    await expect(fsp.access(temp.tempPath)).rejects.toBeTruthy()
    await fsp.rmdir(dir).catch(() => {})
  })
})
