/**
 * What a failed request carried, read by shape: `error.response.status` and `error.response.data.code`.
 *
 * Not `axios.isAxiosError` (as `soulErrorStatus` / `soulErrorCode` in `soul.ts` are): the officer app's tests reject
 * with plain objects such as `{ response: { status: 409 } }`, which that check reads as "no answer". These were
 * written out by hand some 30 times in the officer app, one of them without the `?.` that a thrown `null` needs.
 */
type Shape = { response?: { status?: unknown; data?: { code?: unknown } | null } | null } | null | undefined;

const responseOf = (error: unknown) => (error as Shape)?.response ?? undefined;

/** A response arrived (a refusal, not "offline / no answer"). */
export const answered = (error: unknown): boolean => responseOf(error) !== undefined;

/** The HTTP status of the response, or `undefined` when none arrived. */
export function errorStatus(error: unknown): number | undefined {
  const status = responseOf(error)?.status;
  return typeof status === "number" ? status : undefined;
}

/** The `code` of a `{detail, code}` body, or `undefined`. */
export function errorCode(error: unknown): string | undefined {
  const code = responseOf(error)?.data?.code;
  return typeof code === "string" ? code : undefined;
}
