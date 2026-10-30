import { formatStamp } from "@soulledger/core/domain/dates";

/** A timestamp for a row's second line, `YYYY-MM-DD HH:mm` device time; "" for nothing. The logic is core's `formatStamp`. */
export const formatWhen = (iso: string | null | undefined): string => formatStamp(iso) ?? "";
