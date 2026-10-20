import { describe, expect, it } from "vitest"
import { describeError } from "@/lib/errors"

const axiosFailure = (overrides: Record<string, unknown> = {}) => ({
  isAxiosError: true,
  name: "AxiosError",
  message: "Request failed with status code 500",
  code: "ERR_BAD_RESPONSE",
  response: { status: 500, data: { detail: "boom" } },
  config: {
    method: "post",
    url: "/todos/api/v1/todos",
    headers: { Authorization: "Bearer eyJhbGciOi.secret.payload", "X-CSRF-Token": "csrf-secret" },
    data: '{"title":"private plans"}',
  },
  ...overrides,
})

describe("describeError", () => {
  it("keeps only the status, method, url and code of an Axios error", () => {
    expect(describeError(axiosFailure())).toEqual({
      name: "AxiosError",
      message: "Request failed with status code 500",
      code: "ERR_BAD_RESPONSE",
      status: 500,
      method: "POST",
      url: "/todos/api/v1/todos",
    })
  })

  it("never carries the bearer token, the CSRF token or the request body", () => {
    const logged = JSON.stringify(describeError(axiosFailure()))
    expect(logged).not.toContain("eyJhbGciOi")
    expect(logged).not.toContain("csrf-secret")
    expect(logged).not.toContain("private plans")
  })

  it("redacts an access token in a URL or a message", () => {
    const failure = axiosFailure({
      message: "WebSocket failed: wss://api/realtime/hubs/notifications?access_token=eyJabc.def&x=1",
      config: { method: "get", url: "/realtime/hubs/notifications?access_token=eyJabc.def" },
    })
    const described = describeError(failure)
    expect(described.url).toBe("/realtime/hubs/notifications?access_token=[redacted]")
    expect(described.message).toBe("WebSocket failed: wss://api/realtime/hubs/notifications?access_token=[redacted]&x=1")
  })

  it("keeps an Error's name, message and stack, with tokens redacted", () => {
    const error = new TypeError("header was Bearer abc.def.ghi")
    const described = describeError(error)
    expect(described.name).toBe("TypeError")
    expect(described.message).toBe("header was Bearer [redacted]")
    expect(described.stack).toContain("TypeError")
    expect(described.stack).not.toContain("abc.def.ghi")
  })

  it("reduces anything else to text", () => {
    expect(describeError("socket closed ?access_token=xyz")).toEqual({ message: "socket closed ?access_token=[redacted]" })
    expect(describeError({ config: { headers: { Authorization: "Bearer t" } } })).toEqual({ message: "[object Object]" })
    expect(describeError(undefined)).toEqual({ message: "undefined" })
  })
})
