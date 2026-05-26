import { describe, expect, it } from "vitest"
import {
  newTraceId,
  newSpanId,
  newTraceparent,
  traceparentForExistingTrace,
  extractTraceId,
} from "@/lib/trace"

const TRACEPARENT_RX = /^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/
const HEX32 = /^[0-9a-f]{32}$/
const HEX16 = /^[0-9a-f]{16}$/

describe("trace.ts — W3C trace context", () => {
  it("newTraceId() returns 32 lowercase hex characters", () => {
    const id = newTraceId()
    expect(id).toMatch(HEX32)
  })

  it("newTraceId() returns distinct values across calls (overwhelmingly likely)", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newTraceId()))
    expect(ids.size).toBe(100)
  })

  it("newSpanId() returns 16 lowercase hex characters", () => {
    const id = newSpanId()
    expect(id).toMatch(HEX16)
  })

  it("newSpanId() returns distinct values across calls", () => {
    const ids = new Set(Array.from({ length: 100 }, () => newSpanId()))
    expect(ids.size).toBe(100)
  })

  it("newTraceparent() returns a spec-compliant value with sampled flag set", () => {
    const tp = newTraceparent()
    expect(tp).toMatch(TRACEPARENT_RX)
  })

  it("traceparentForExistingTrace reuses the supplied trace-id and generates a fresh span-id", () => {
    const traceId = newTraceId()
    const tp1 = traceparentForExistingTrace(traceId)
    const tp2 = traceparentForExistingTrace(traceId)

    expect(tp1).toMatch(TRACEPARENT_RX)
    expect(tp2).toMatch(TRACEPARENT_RX)
    expect(extractTraceId(tp1)).toBe(traceId)
    expect(extractTraceId(tp2)).toBe(traceId)

    // Different span-ids:
    const span1 = tp1.split("-")[2]
    const span2 = tp2.split("-")[2]
    expect(span1).not.toBe(span2)
  })

  it("traceparentForExistingTrace rejects a malformed trace-id", () => {
    expect(() => traceparentForExistingTrace("not-hex")).toThrow(/Invalid trace-id/)
    expect(() => traceparentForExistingTrace("ABCDEF".repeat(6))).toThrow(/Invalid trace-id/)
    expect(() => traceparentForExistingTrace("0".repeat(32))).toThrow(/cannot be all zeros/)
  })

  it("extractTraceId parses a valid traceparent", () => {
    const tp = newTraceparent()
    const traceId = extractTraceId(tp)
    expect(traceId).toMatch(HEX32)
    expect(tp).toContain(traceId!)
  })

  it("extractTraceId returns null for malformed input", () => {
    expect(extractTraceId(null)).toBeNull()
    expect(extractTraceId(undefined)).toBeNull()
    expect(extractTraceId("")).toBeNull()
    expect(extractTraceId("nope")).toBeNull()
    expect(extractTraceId("01-aabbccddeeff00112233445566778899-aabbccddeeff0011-01")).toBeNull() // wrong version byte
    expect(extractTraceId("00-" + "0".repeat(32) + "-aabbccddeeff0011-01")).toBeNull() // invalid all-zero trace-id
  })
})
