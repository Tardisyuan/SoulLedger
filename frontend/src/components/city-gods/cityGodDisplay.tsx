import { MissingValue } from "@/src/components/ui/DomainValue";
import { CITY_GOD_CASE_ERROR_CODES, type CityGodStatus } from "@soulledger/core/api";
import type { BadgeTone } from "@/src/components/ui/Badge";

/** 初审状态的徽章色调:退回补正等的是补资料,用 warning;解送是走完了,中性。 */
export const CITY_GOD_STATUS_TONES: Record<CityGodStatus, BadgeTone> = {
  PENDING: "info",
  RETURNED: "warning",
  SENT_ON: "neutral",
};

/**
 * 出身地,决定归属的那个地名加粗下划线(第五十三批 Q-1:规则是「最后写中的」,不标出来,分错时没人看得出为什么)。
 * `region` 是后端算好的 `matched_region`(按同一条规则取最后一次出现);兜底收的为 null,原样写。空出身地写「—」。
 */
export function MatchedOrigin({ location, region }: { location: string; region: string | null | undefined }) {
  if (!location.trim()) return <MissingValue kind="unrecorded" />;
  const at = region ? location.toLowerCase().lastIndexOf(region.toLowerCase()) : -1;
  if (at < 0 || !region) return <>{location}</>;
  return (
    <>
      {location.slice(0, at)}
      <strong data-matched-region="" className="font-semibold underline underline-offset-2">
        {location.slice(at, at + region.length)}
      </strong>
      {location.slice(at + region.length)}
    </>
  );
}

type T = (key: string, params?: Record<string, string>) => string;
type ErrorBody = { code?: string; [field: string]: unknown };

function bodyOf(err: unknown): ErrorBody | undefined {
  return (err as { response?: { data?: ErrorBody } })?.response?.data;
}

/** 初审动作被拒:`cityGodCases.error.<code>`;认不出的码落到认领那一族的通用句。 */
export function cityGodCaseRefusalCode(err: unknown): string | null {
  const code = bodyOf(err)?.code;
  return code && (CITY_GOD_CASE_ERROR_CODES as readonly string[]).includes(code) ? code : null;
}

export function cityGodCaseRefusalMessage(err: unknown, t: T): string {
  const code = cityGodCaseRefusalCode(err);
  return code ? t(`cityGodCases.error.${code}`) : t("judgment.claim.refused.generic");
}

/** 编辑抽屉保存被拒(`city_god_views._refusal`):`{"<字段>": {code, region?, city_god?, name?}}`。 */
export interface CityGodFieldRefusal {
  code: string;
  region?: string;
  regions?: string[];
  city_god?: string;
  name?: string;
}

const FIELD_CODES = ["name_taken", "region_taken", "default_taken", "invalid_officer", "city_god_has_tudi_gods"];

export function cityGodFieldRefusal(err: unknown): CityGodFieldRefusal | null {
  const body = bodyOf(err);
  if (!body) return null;
  if (body.code === "city_gods_diyu_only") return { code: body.code };
  for (const value of Object.values(body)) {
    const v = value as Partial<CityGodFieldRefusal> | null;
    if (v && typeof v === "object" && !Array.isArray(v) && v.code && FIELD_CODES.includes(v.code)) return v as CityGodFieldRefusal;
  }
  return null;
}

export function cityGodFieldMessage(refusal: CityGodFieldRefusal, t: T): string {
  return t(`cityGods.error.${refusal.code}`, {
    region: refusal.region ?? "",
    city_god: refusal.city_god ?? "",
    name: refusal.name ?? "",
  });
}
