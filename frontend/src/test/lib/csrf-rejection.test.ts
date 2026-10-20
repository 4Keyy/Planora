import { describe, expect, it } from "vitest"
import { CSRF_FAILURE_CODE, isCsrfRejection } from "@/lib/csrf"

describe("isCsrfRejection", () => {
  it("recognises the CSRF middleware's 403, parsed or as text", () => {
    expect(isCsrfRejection({ response: { status: 403, data: { error: CSRF_FAILURE_CODE } } })).toBe(true)
    expect(isCsrfRejection({ response: { status: 403, data: `{"error":"${CSRF_FAILURE_CODE}"}` } })).toBe(true)
  })

  it("treats every other refusal as final", () => {
    expect(isCsrfRejection({ response: { status: 403, data: { error: "USER_LOCKED" } } })).toBe(false)
    expect(isCsrfRejection({ response: { status: 403 } })).toBe(false)
    expect(isCsrfRejection({ response: { status: 401, data: { error: CSRF_FAILURE_CODE } } })).toBe(false)
    expect(isCsrfRejection(new Error("network"))).toBe(false)
    expect(isCsrfRejection(null)).toBe(false)
  })
})
