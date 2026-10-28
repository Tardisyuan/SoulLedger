/** 土地公接口的拒绝码(`apps/death_sync/tudi_views.py`)。在顶层 `code`,或在某个字段下 `{code}` / `{code: [..]}`。 */
const KNOWN = ["name_taken", "invalid_city_god", "tudi_city_god_not_county", "invalid_officer", "tudi_gods_diyu_only",
  "not_tudi_officer"] as const;
export type TudiRefusalCode = (typeof KNOWN)[number];

function codeIn(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const code = (value as { code?: unknown }).code;
  if (typeof code === "string") return code;
  if (Array.isArray(code) && typeof code[0] === "string") return code[0];
  for (const v of Object.values(value)) {
    const found = codeIn(v);
    if (found) return found;
  }
  return null;
}

export function tudiRefusalCode(err: unknown): TudiRefusalCode | null {
  const code = codeIn((err as { response?: { data?: unknown } })?.response?.data);
  return code && (KNOWN as readonly string[]).includes(code) ? (code as TudiRefusalCode) : null;
}

type T = (key: string, params?: Record<string, string>) => string;

/** 认得的码一句话;「上级只能是县城隍」用城隍那一族已有的句子;认不出的落到通用句。 */
export function tudiRefusalMessage(err: unknown, t: T): string {
  const code = tudiRefusalCode(err);
  if (code === "tudi_city_god_not_county") return t("cityGods.error.tudi_city_god_not_county");
  return code ? t(`earthGods.error.${code}`) : t("common.error");
}
