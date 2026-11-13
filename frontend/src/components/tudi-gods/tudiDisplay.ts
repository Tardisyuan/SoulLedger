import { problemErrors, responseCode } from "@soulledger/core/api/client";
/** 土地公接口的拒绝码(`apps/death_sync/tudi_views.py`)。在顶层 `code`,或在校验问题的某条 `errors` 上。 */
const KNOWN = ["name_taken", "invalid_city_god", "tudi_city_god_not_county", "invalid_officer", "tudi_gods_diyu_only",
  "not_tudi_officer"] as const;
export type TudiRefusalCode = (typeof KNOWN)[number];

const isKnown = (code: string | null | undefined): code is TudiRefusalCode => !!code && (KNOWN as readonly string[]).includes(code);

export function tudiRefusalCode(err: unknown): TudiRefusalCode | null {
  const top = responseCode(err);
  if (isKnown(top)) return top;
  return problemErrors(err).map((e) => e.code).find(isKnown) ?? null;
}

type T = (key: string, params?: Record<string, string>) => string;

/** 认得的码一句话;「上级只能是县城隍」用城隍那一族已有的句子;认不出的落到通用句。 */
export function tudiRefusalMessage(err: unknown, t: T): string {
  const code = tudiRefusalCode(err);
  if (code === "tudi_city_god_not_county") return t("cityGods.error.tudi_city_god_not_county");
  return code ? t(`earthGods.error.${code}`) : t("common.error");
}

/**
 * 能不能以这位土地公的名义登记死亡:除了 `soul.die`(调用方查),后端还要「他名下的官员,或持 `judgment.assign`」
 * (`tudi_views.register_death`,否则 403 `not_tudi_officer`)。入口按同一条规则画,不让人点了才被拒。
 */
export function mayRegisterUnder(god: { officers: { id: number }[] }, userId: number | undefined, canAssign: boolean): boolean {
  return canAssign || (userId !== undefined && god.officers.some((o) => o.id === userId));
}
