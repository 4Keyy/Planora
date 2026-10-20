import { describe, expect, it } from "vitest"
import { restoreTimeZone, setTimeZone } from "@/test/time-zone"

// Every time-zone test leans on this: a test that leaves another zone behind makes every later
// test in the worker run there, passing or failing for the wrong reason.
describe("the test time-zone switch", () => {
  it("puts back the zone and the TZ variable the file started with", () => {
    const tz = process.env.TZ
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    const instant = new Date("2026-10-20T22:30:00.000Z")
    const hours = instant.getHours()

    setTimeZone(zone === "Asia/Tokyo" ? "America/New_York" : "Asia/Tokyo")
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).not.toBe(zone)

    restoreTimeZone()
    expect(process.env.TZ).toBe(tz)
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(zone)
    expect(instant.getHours()).toBe(hours)
  })
})
