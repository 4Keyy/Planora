/**
 * Minimal W3C Trace Context generator for the browser → API boundary.
 *
 * The backend services consume the standard `traceparent` header through
 * the OpenTelemetry AspNetCore instrumentation registered by
 * `AddPlanoraTelemetry`. Sending the header from the browser is enough to
 * stitch the resulting frontend → gateway → service spans into a single
 * end-to-end trace in the configured OTLP backend.
 *
 * We deliberately do NOT pull `@opentelemetry/api` + `@opentelemetry/sdk-trace-web`
 * into the bundle. The browser side only needs to:
 *   1. Emit a valid `traceparent` per outbound request.
 *   2. Use the same `trace-id` for every request a single user action
 *      fans out (so the resulting backend spans group into one trace).
 *
 * Both are achievable in ~50 lines without runtime cost.
 *
 * Format: `00-<32 hex trace-id>-<16 hex span-id>-01`
 * Spec:   https://www.w3.org/TR/trace-context/#traceparent-header
 */

const VERSION = "00";
const SAMPLED_FLAG = "01"; // we let the backend decide the actual sampling

const HEX_CHARS = "0123456789abcdef";
const INVALID_TRACE_ID = "00000000000000000000000000000000";
const INVALID_SPAN_ID = "0000000000000000";

/**
 * Returns a cryptographically random hex string of the requested even length.
 * Falls back to `Math.random` only on environments without `crypto.getRandomValues`
 * (Node.js < 19 or very old browsers); the fallback is never reached in any
 * Planora-supported runtime (modern browsers + Next.js 15 SSR).
 */
function randomHex(length: number): string {
  if (length <= 0 || length % 2 !== 0) {
    throw new Error(`randomHex expected an even positive length, got ${length}`);
  }
  const bytes = new Uint8Array(length / 2);
  const cryptoObj: Crypto | undefined =
    typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoObj?.getRandomValues) {
    cryptoObj.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    out += HEX_CHARS[b >> 4] + HEX_CHARS[b & 0xf];
  }
  return out;
}

/**
 * Generates a fresh 32-character lowercase-hex W3C trace-id. The value `00`*32
 * is reserved by the spec as "invalid"; we re-roll until a valid id is produced.
 * The probability of needing the loop is 2^-128 — practically never — but the
 * guard keeps the function honest under contrived test inputs.
 */
export function newTraceId(): string {
  let id = randomHex(32);
  while (id === INVALID_TRACE_ID) {
    id = randomHex(32);
  }
  return id;
}

/**
 * Generates a fresh 16-character lowercase-hex W3C span-id.
 */
export function newSpanId(): string {
  let id = randomHex(16);
  while (id === INVALID_SPAN_ID) {
    id = randomHex(16);
  }
  return id;
}

/**
 * Builds a fully-formed `traceparent` header value with a fresh trace-id and
 * span-id, sampled-flag set. The backend will pick this up via the AspNetCore
 * OpenTelemetry propagator without any extra configuration.
 */
export function newTraceparent(): string {
  return `${VERSION}-${newTraceId()}-${newSpanId()}-${SAMPLED_FLAG}`;
}

/**
 * Builds a `traceparent` header that reuses an existing trace-id. Useful when
 * a single user action fans out into multiple API calls — every request gets
 * its own span-id but they all roll up to the same parent trace, so the
 * backend collector groups them in the trace view.
 */
export function traceparentForExistingTrace(traceId: string): string {
  if (!/^[0-9a-f]{32}$/.test(traceId)) {
    throw new Error(`Invalid trace-id "${traceId}" — expected 32 lowercase hex characters`);
  }
  if (traceId === INVALID_TRACE_ID) {
    throw new Error("Invalid trace-id: cannot be all zeros");
  }
  return `${VERSION}-${traceId}-${newSpanId()}-${SAMPLED_FLAG}`;
}

/**
 * Extracts the 32-char trace-id from a previously-issued traceparent value,
 * or `null` if the header is malformed. The header is treated as untrusted
 * input — we never throw on malformed values, we just return `null` so callers
 * can fall through to generating a fresh trace.
 */
export function extractTraceId(traceparent: string | null | undefined): string | null {
  if (!traceparent) return null;
  const match = /^00-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/.exec(traceparent);
  if (!match) return null;
  if (match[1] === INVALID_TRACE_ID) return null;
  return match[1];
}
