import axios from "axios";

/**
 * DRF's two error shapes, read as two different things.
 *
 * A serializer rejects a request in one of two ways, and the app only ever
 * handled one of them:
 *
 *   { "non_field_errors": ["Cannot dispatch to your own tenant."] }   // object-level
 *   { "reason": ["This field may not be blank."], "soul": ["..."] }   // per-field
 *
 * `useSocial.ts` carried a private reader for the first shape. Nothing read the
 * second — so a per-field rejection arrived as one generic toast
 * ("发起调度失败") with no indication of WHICH field the server refused, on a
 * form with three required controls. The operator's only move was to guess.
 *
 * Split into two functions rather than one that returns both, because the call
 * sites want different things: a field map goes into `<Field error=…>`, and a
 * non-field message goes into a toast. A single return would make every caller
 * destructure something it does not use.
 */

/** `{ field: "first message" }` for a per-field DRF rejection; `{}` otherwise. */
export function drfFieldErrors(error: unknown): Record<string, string> {
  if (!axios.isAxiosError(error)) return {};
  const data: unknown = error.response?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return {};

  const out: Record<string, string> = {};
  for (const [field, value] of Object.entries(data as Record<string, unknown>)) {
    // `non_field_errors` and `detail` are object-level; they belong in a toast,
    // not pinned under a control the server never named.
    if (field === "non_field_errors" || field === "detail") continue;
    if (Array.isArray(value) && typeof value[0] === "string") {
      out[field] = value[0];
    } else if (typeof value === "string") {
      out[field] = value;
    }
  }
  return out;
}

/**
 * The object-level message, or `fallback`.
 *
 * `fallback` is required rather than defaulted: a generic default is how a
 * caller ends up showing "Error" in a Chinese interface, and the caller is the
 * only one that knows which translated string belongs here.
 */
export function drfNonFieldError(error: unknown, fallback: string): string {
  if (!axios.isAxiosError(error)) return fallback;
  const data: unknown = error.response?.data;
  if (data && typeof data === "object") {
    const record = data as { non_field_errors?: unknown; detail?: unknown };
    if (Array.isArray(record.non_field_errors) && typeof record.non_field_errors[0] === "string") {
      return record.non_field_errors[0];
    }
    if (typeof record.detail === "string") return record.detail;
  }
  return fallback;
}
