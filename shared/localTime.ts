const pad = (value: number) => String(value).padStart(2, '0')
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Offset suffix such as `UTC+08:00`, shared by prompts, tool results and screenshots. */
export function localTimeZoneLabel(date: Date): string {
  const offset = -date.getTimezoneOffset()
  const sign = offset < 0 ? '-' : '+'
  const abs = Math.abs(offset)
  return `UTC${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

/** `2026-11-03 14:05:07 UTC+08:00`: a wall-clock time the model can quote back to the user. */
export function formatLocalDateTime(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${localTimeZoneLabel(date)}`
}

/**
 * One line for the per-request system text. The date alone is enough to turn
 * "tomorrow at 8:00" into startAt; the minute hand comes back in the tool result.
 */
export function localDateLine(ms: number): string {
  const date = new Date(ms)
  return `Local date: ${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `(${WEEKDAYS[date.getDay()]}), timezone ${localTimeZoneLabel(date)}. Scheduled commands run in this timezone.`
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\s*(?:UTC|GMT)?(Z|[+-]\d{2}:?\d{2}))?$/
const ZONE = /^([+-])(\d{2}):?(\d{2})$/

/** `YYYY-MM-DD HH:mm[:ss]` local time, or ISO 8601 with `Z`/offset; undefined when malformed. */
export function parseLocalDateTime(text: string): number | undefined {
  const match = LOCAL_TIME.exec(text.trim())
  if (!match) return undefined
  const [, year, month, day, hour, minute, second, zone] = match
  const y = Number(year), mo = Number(month), d = Number(day), h = Number(hour), mi = Number(minute), s = Number(second ?? '0')
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return undefined
  if (zone && zone !== 'Z') {
    const parts = ZONE.exec(zone)
    if (!parts) return undefined
    const hours = Number(parts[2]), minutes = Number(parts[3])
    if (hours > 14 || minutes > 59) return undefined
    const offset = (parts[1] === '-' ? -1 : 1) * (hours * 60 + minutes)
    return Date.UTC(y, mo - 1, d, h, mi, s) - offset * 60_000
  }
  if (zone === 'Z') return Date.UTC(y, mo - 1, d, h, mi, s)
  const local = new Date(y, mo - 1, d, h, mi, s)
  // Reject calendar overflow such as 2026-02-30 that Date silently rolls forward.
  return local.getMonth() === mo - 1 && local.getDate() === d && local.getFullYear() === y ? local.getTime() : undefined
}
