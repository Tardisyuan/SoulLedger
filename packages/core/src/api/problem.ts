/**
 * The one reader of the API's error body: an RFC 9457 problem (`application/problem+json`,
 * `backend/apps/core/problems.py`, 2026-11-14).
 *
 *   { type, title, status, code, detail?, instance?, errors?: [{ field?, code, detail }], ...extensions }
 *
 * `code` is the stable key to branch on (`responseCode` in ./client reads it too); `detail` is one sentence
 * for a person; `errors` is a validation problem's per-field list (`field` absent = the whole request;
 * nested fields are dotted, `items.0.name`). Extension members (`claimed_by`, `retry_after` …) stay flat,
 * so `responseData` still reads them.
 */
import type { components } from "./generated/schema";

export type Problem = components["schemas"]["Problem"] & Record<string, unknown>;
export type ProblemFieldError = components["schemas"]["ProblemFieldError"];

/** The body of a failed request (any rejection shaped like an axios error) when it is an object, or `null`. */
export function problemOf(error: unknown): Problem | null {
  const data = (error as { response?: { data?: unknown } } | null)?.response?.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  // Not checked for `code` / `status`: a reader of one member (`detail`, `errors`) should not fail on a body
  // that lacks another; each reader checks the member it reads.
  return data as Problem;
}

/** The problem's one sentence for a person, when it has one. */
export function problemDetail(error: unknown): string | undefined {
  const detail = problemOf(error)?.detail;
  return typeof detail === "string" && detail ? detail : undefined;
}

/** A validation problem's `errors`, or `[]`. */
export function problemErrors(error: unknown): ProblemFieldError[] {
  const errors = problemOf(error)?.errors;
  return Array.isArray(errors) ? errors.filter((e) => e && typeof e.detail === "string") : [];
}

/** `{ field: "first message" }` of a validation problem; object-level errors (no `field`) are not in it. */
export function problemFieldErrors(error: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of problemErrors(error)) if (e.field && !(e.field in out)) out[e.field] = e.detail;
  return out;
}

/** `{ field: [code, …] }` of a validation problem, in the server's order. */
export function problemFieldCodes(error: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of problemErrors(error)) if (e.field) (out[e.field] ??= []).push(e.code);
  return out;
}

/** Every message of a validation problem by field, object-level ones under `non_field_errors` (DRF's name). */
export function problemFieldMessages(error: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of problemErrors(error)) (out[e.field ?? "non_field_errors"] ??= []).push(e.detail);
  return out;
}
