/**
 * Dates in this app are *floating*: a bare calendar day with no time and no
 * timezone, held as a `YYYY-MM-DD` string.
 *
 * The Google Tasks API cannot store a time of day at all — it returns `due` as
 * something like `2026-08-13T00:00:00.000Z`, which looks like an instant but
 * isn't one. Passing that through `Date` and reading it back gives the wrong
 * day for anyone east or west of UTC. So it never goes through `Date`: we slice
 * the date part off and compare strings, which sort correctly by construction.
 *
 * The branded type exists to make that rule enforceable rather than remembered.
 */
export type FloatingDate = string & { readonly __floatingDate: unique symbol }

const FLOATING_DATE = /^\d{4}-\d{2}-\d{2}$/

export function isFloatingDate(value: string): value is FloatingDate {
  return FLOATING_DATE.test(value)
}

/** Narrow a known-good `YYYY-MM-DD` string. Throws on anything else. */
export function floatingDate(value: string): FloatingDate {
  if (!isFloatingDate(value)) {
    throw new Error(`Not a floating date: ${value}`)
  }
  return value
}

/** The local calendar day. Uses the device's own notion of "today". */
export function today(): FloatingDate {
  return fromLocalDate(new Date())
}

/** Read a `Date` as the calendar day it represents *in local time*. */
export function fromLocalDate(date: Date): FloatingDate {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}` as FloatingDate
}

/**
 * Parse the Tasks API `due` field. Deliberately a string slice: see the note at
 * the top of this file for why this must not construct a `Date`.
 */
export function parseGoogleDue(due: string | undefined | null): FloatingDate | null {
  if (!due) return null
  const date = due.slice(0, 10)
  return isFloatingDate(date) ? date : null
}

/** Format a floating date for the Tasks API, which wants a full RFC 3339 stamp. */
export function toGoogleDue(date: FloatingDate | null): string | null {
  return date ? `${date}T00:00:00.000Z` : null
}

/** Shift a floating date by whole days, staying in the local calendar. */
export function addDays(date: FloatingDate, days: number): FloatingDate {
  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  // Local-time constructor, so DST transitions don't shift the day.
  const shifted = new Date(year, month - 1, day + days)
  return fromLocalDate(shifted)
}

export function isBefore(a: FloatingDate, b: FloatingDate): boolean {
  return a < b
}

export function isAfter(a: FloatingDate, b: FloatingDate): boolean {
  return a > b
}

/** Short label for a task row: "Today", "Tomorrow", "Mon", or "13 Aug". */
export function formatRelative(date: FloatingDate, from: FloatingDate = today()): string {
  if (date === from) return 'Today'
  if (date === addDays(from, 1)) return 'Tomorrow'
  if (date === addDays(from, -1)) return 'Yesterday'

  const [year, month, day] = date.split('-').map(Number) as [number, number, number]
  const asDate = new Date(year, month - 1, day)

  // Within the coming week, the weekday name is more useful than the date.
  if (date > from && date < addDays(from, 7)) {
    return asDate.toLocaleDateString(undefined, { weekday: 'short' })
  }

  const sameYear = date.slice(0, 4) === from.slice(0, 4)
  return asDate.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}
