import { afterEach, expect, it, vi } from 'vitest'
import { aiScheduleConcurrency, aiScheduleTimingKey, nextAiScheduleRun, validateAiSchedule, type AiScheduleInput } from './aiSchedules'

afterEach(() => vi.unstubAllEnvs())
const base: AiScheduleInput = { name: 'inspect', connectionId: 'host', prompt: 'check', intervalMinutes: 60, enabled: true }
const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).getTime()

it('preserves older interval plans and normalizes explicit interval scheduling', () => {
  expect(nextAiScheduleRun(base, 1000)).toBe(3601000)
  expect(aiScheduleTimingKey(base)).toBe(aiScheduleTimingKey({ ...base, timing: { kind: 'interval' } }))
  expect(validateAiSchedule({ ...base, timing: { kind: 'interval' } }).timing).toBeUndefined()
})

it('normalizes nested reactive timing into plain data that can cross IPC', () => {
  const timing = new Proxy({ kind: 'weekly' as const, time: '08:15', weekday: 5 }, {})
  const normalized = validateAiSchedule({ ...base, timing })
  expect(structuredClone(normalized).timing).toEqual({ kind: 'weekly', time: '08:15', weekday: 5 })
  expect(normalized.timing).not.toBe(timing)
})

it('normalizes multiple targets into distinct saved connection IDs and keeps the legacy primary ID', () => {
  const normalized = validateAiSchedule({ ...base, connectionIds: ['b','a','b'] })
  expect(normalized.connectionId).toBe('b')
  expect(normalized.connectionIds).toEqual(['b','a'])
  expect(() => validateAiSchedule({ ...base, connectionIds: [] })).toThrow()
  expect(() => validateAiSchedule({ ...base, connectionIds: Array.from({ length: 11 }, (_, i) => String(i)) })).toThrow()
})

it('keeps optional model and concurrency unset for older plans and rejects incomplete pairs', () => {
  expect(validateAiSchedule(base)).toMatchObject({ providerId: undefined, model: undefined, concurrency: undefined })
  expect(validateAiSchedule({ ...base, providerId: 'p', model: 'm', concurrency: 3 })).toMatchObject({ providerId: 'p', model: 'm', concurrency: 3 })
  expect(validateAiSchedule({ ...base, concurrency: 1 }).concurrency).toBeUndefined()
  expect(aiScheduleConcurrency({ ...base, concurrency: 5 })).toBe(5)
  expect(aiScheduleConcurrency(base)).toBe(1)
  expect(() => validateAiSchedule({ ...base, providerId: 'p' })).toThrow()
  expect(() => validateAiSchedule({ ...base, model: 'm' })).toThrow()
  expect(() => validateAiSchedule({ ...base, concurrency: 6 })).toThrow()
})

it.each(['24:00', '09:60', '9:00', '09:00:01', '09:00:60', '', 'invalid'])('rejects invalid local time %s', time => {
  expect(() => validateAiSchedule({ ...base, timing: { kind: 'daily', time } })).toThrow()
})

it('normalizes browser time values with zero seconds to minute precision', () => {
  expect(validateAiSchedule({ ...base, timing: { kind: 'daily', time: '09:00:00' } }).timing).toEqual({ kind: 'daily', time: '09:00' })
  expect(validateAiSchedule({ ...base, timing: { kind: 'weekly', time: '23:59:00', weekday: 2 } }).timing).toEqual({ kind: 'weekly', time: '23:59', weekday: 2 })
})

it.each([-1, 7, 1.5, null])('rejects invalid weekday %s', weekday => {
  expect(() => validateAiSchedule({ ...base, timing: { kind: 'weekly', time: '09:00', weekday } } as any)).toThrow()
})

it.each([null, false, {}, { kind: 'cron' }])('rejects an invalid timing object %j', timing => {
  expect(() => validateAiSchedule({ ...base, timing } as any)).toThrow()
})

it('runs daily at a local wall time and always advances strictly past the reference', () => {
  const daily: AiScheduleInput = { ...base, timing: { kind: 'daily', time: '09:30' } }
  expect(nextAiScheduleRun(daily, local(13, 8))).toBe(local(13, 9, 30))
  expect(nextAiScheduleRun(daily, local(13, 9, 30))).toBe(local(14, 9, 30))
  expect(nextAiScheduleRun(daily, local(13, 23))).toBe(local(14, 9, 30))
})

it('runs weekly on the selected weekday, including Sunday and year boundaries', () => {
  const tuesday: AiScheduleInput = { ...base, timing: { kind: 'weekly', weekday: 2, time: '09:00' } }
  expect(nextAiScheduleRun(tuesday, local(13, 8))).toBe(local(13, 9))
  expect(nextAiScheduleRun(tuesday, local(13, 9))).toBe(local(20, 9))
  expect(nextAiScheduleRun({ ...base, timing: { kind: 'weekly', weekday: 0, time: '00:00' } }, local(13, 8))).toBe(local(18, 0))
  const after = new Date(2026, 11, 31, 12).getTime()
  expect(nextAiScheduleRun({ ...base, timing: { kind: 'weekly', weekday: 1, time: '09:00' } }, after)).toBe(new Date(2027, 0, 4, 9).getTime())
})

it('uses calendar days instead of 24-hour offsets across daylight-saving transitions', () => {
  vi.stubEnv('TZ', 'America/New_York')
  const daily: AiScheduleInput = { ...base, timing: { kind: 'daily', time: '09:00' } }
  const spring = new Date(2026, 2, 7, 9).getTime()
  expect(nextAiScheduleRun(daily, spring)).toBe(new Date(2026, 2, 8, 9).getTime())
  expect(nextAiScheduleRun(daily, spring) - spring).toBe(23 * 3600000)
  const fall = new Date(2026, 9, 31, 9).getTime()
  expect(nextAiScheduleRun(daily, fall) - fall).toBe(25 * 3600000)
})

it('moves a nonexistent spring time forward and does not repeat a fall time twice', () => {
  vi.stubEnv('TZ', 'America/New_York')
  const gap = nextAiScheduleRun({ ...base, timing: { kind: 'daily', time: '02:30' } }, new Date(2026, 2, 8, 0).getTime())
  expect(gap).toBe(new Date(2026, 2, 8, 3, 30).getTime())
  const repeat: AiScheduleInput = { ...base, timing: { kind: 'daily', time: '01:30' } }
  const first = nextAiScheduleRun(repeat, new Date(2026, 10, 1, 0).getTime())
  expect(nextAiScheduleRun(repeat, first)).toBe(new Date(2026, 10, 2, 1, 30).getTime())
})
