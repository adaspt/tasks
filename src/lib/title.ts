/**
 * Priority has no home in the Google Tasks API — there is no priority field and
 * the star in Google's own app is not exposed. So it lives in the title, as a
 * leading `!`.
 *
 * The point of that choice is symmetry: typing `! Renew passport` in the
 * official Google app sets priority here too, and vice versa. The prefix is
 * stripped for display and re-attached on save, so it is never seen in this app.
 *
 * Known cost: a title that genuinely begins with `!` loses the character. This
 * is accepted rather than escaped.
 */

export type Priority = 0 | 1

const PRIORITY_PREFIX = /^!\s*/

export interface ParsedTitle {
  title: string
  priority: Priority
}

/** Split a raw Google Tasks title into display title and priority. */
export function parseTitle(raw: string): ParsedTitle {
  const trimmed = raw.trim()
  if (!PRIORITY_PREFIX.test(trimmed)) {
    return { title: trimmed, priority: 0 }
  }
  return { title: trimmed.replace(PRIORITY_PREFIX, ''), priority: 1 }
}

/** Build the raw title to send to Google. Normalised to `! ` for readability. */
export function formatTitle(title: string, priority: Priority): string {
  const clean = title.trim()
  return priority === 1 ? `! ${clean}` : clean
}
