import { describe, expect, it } from 'vitest'
import {
  addDays,
  floatingDate,
  formatRelative,
  fromLocalDate,
  parseGoogleDue,
  toGoogleDue,
} from './dates'

describe('parseGoogleDue', () => {
  it('reads the calendar day without going through Date', () => {
    // The whole point: Google sends a UTC-looking stamp for a date-only value.
    // Anyone west of UTC would get the previous day out of `new Date(...)`.
    expect(parseGoogleDue('2026-08-13T00:00:00.000Z')).toBe('2026-08-13')
  })

  it('treats missing dates as backlog', () => {
    expect(parseGoogleDue(undefined)).toBeNull()
    expect(parseGoogleDue(null)).toBeNull()
    expect(parseGoogleDue('')).toBeNull()
  })

  it('rejects anything that is not a date', () => {
    expect(parseGoogleDue('not-a-date')).toBeNull()
  })

  it('round-trips through the API format', () => {
    const date = floatingDate('2026-08-13')
    expect(parseGoogleDue(toGoogleDue(date))).toBe(date)
  })
})

describe('addDays', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays(floatingDate('2026-08-31'), 1)).toBe('2026-09-01')
    expect(addDays(floatingDate('2026-12-31'), 1)).toBe('2027-01-01')
    expect(addDays(floatingDate('2026-01-01'), -1)).toBe('2025-12-31')
  })

  it('handles leap years', () => {
    expect(addDays(floatingDate('2028-02-28'), 1)).toBe('2028-02-29')
    expect(addDays(floatingDate('2027-02-28'), 1)).toBe('2027-03-01')
  })

  it('does not lose a day across a DST transition', () => {
    // Both of these span the European clock changes. Using a UTC-based
    // calculation here would drift by one day in some timezones.
    expect(addDays(floatingDate('2026-03-28'), 1)).toBe('2026-03-29')
    expect(addDays(floatingDate('2026-10-24'), 1)).toBe('2026-10-25')
  })
})

describe('fromLocalDate', () => {
  it('reads a Date as its local calendar day', () => {
    expect(fromLocalDate(new Date(2026, 7, 13, 23, 59))).toBe('2026-08-13')
    expect(fromLocalDate(new Date(2026, 0, 1, 0, 0))).toBe('2026-01-01')
  })
})

describe('formatRelative', () => {
  const now = floatingDate('2026-08-13')

  it('names the days around today', () => {
    expect(formatRelative(now, now)).toBe('Today')
    expect(formatRelative(floatingDate('2026-08-14'), now)).toBe('Tomorrow')
    expect(formatRelative(floatingDate('2026-08-12'), now)).toBe('Yesterday')
  })

  it('falls back to a date for anything further out', () => {
    expect(formatRelative(floatingDate('2026-09-30'), now)).toMatch(/30/)
  })
})

describe('floatingDate', () => {
  it('refuses malformed input rather than passing it on', () => {
    expect(() => floatingDate('13/08/2026')).toThrow()
    expect(() => floatingDate('2026-08-13T00:00:00Z')).toThrow()
  })
})
