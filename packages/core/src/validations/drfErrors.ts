import { problemDetail, problemErrors, problemFieldErrors } from "../api/problem";

/**
 * A validation problem read as two different things (the body is `../api/problem`):
 *
 *   errors: [{ code: "pick_one", detail: "Cannot dispatch to your own tenant." }]     // object-level
 *   errors: [{ field: "reason", code: "blank", detail: "This field may not be blank." }]  // per-field
 *
 * Nothing used to read the per-field kind — a per-field rejection arrived as one generic toast
 * ("发起调度失败") with no indication of WHICH field the server refused, on a form with three
 * required controls.
 *
 * Two functions rather than one that returns both, because the call sites want different things: a
 * field map goes into `<Field error=…>`, and a non-field message goes into a toast.
 */

/** `{ field: "first message" }` for a per-field rejection; `{}` otherwise. */
export function drfFieldErrors(error: unknown): Record<string, string> {
  return problemFieldErrors(error);
}

/**
 * The object-level message (an `errors` item without `field`, else a non-validation problem's `detail`),
 * or `fallback`.
 *
 * `fallback` is required rather than defaulted: a generic default is how a caller ends up showing "Error"
 * in a Chinese interface, and the caller is the only one that knows which translated string belongs here.
 */
export function drfNonFieldError(error: unknown, fallback: string): string {
  const errors = problemErrors(error);
  if (errors.length) return errors.find((e) => !e.field)?.detail ?? fallback;
  return problemDetail(error) ?? fallback;
}
