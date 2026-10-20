/**
 * Switching time zones in a test. Node re-reads `process.env.TZ` when it is assigned, so a test
 * can run date code as a viewer elsewhere would. Putting the zone back takes care: assigning
 * `undefined` stores the string "undefined" (the zone becomes Etc/Unknown, which is UTC), and
 * deleting the variable leaves the last zone in force. So the zone the file started in is
 * assigned back by name and only then is the variable removed — otherwise every later test in
 * the worker would run in whichever zone the last test chose.
 */
const initialTz = process.env.TZ
const initialZone = Intl.DateTimeFormat().resolvedOptions().timeZone

/** Run the date code that follows as a viewer in `tz` (an IANA id) would. */
export function setTimeZone(tz: string): void {
  process.env.TZ = tz
}

/** Back to the zone the test file started in, with `TZ` unset again if it was unset. */
export function restoreTimeZone(): void {
  process.env.TZ = initialTz ?? initialZone
  if (initialTz === undefined) delete process.env.TZ
}
