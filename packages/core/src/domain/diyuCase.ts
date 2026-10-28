/**
 * 地府案子的两组选项:罪目(自动选殿按它)与枉死城(死因、冤情等级)。成员与后端
 * `apps/judgment/models.py` 的 `ChineseOffence` / `OFFENCE_COURT` / `WrongfulDeathCause` / `GrievanceLevel` 相同,
 * `backend/tests/test_diyu_offence_wangsi_city_god.py` 对照。
 */

/** 罪目按殿分组:二至九殿各掌的罪类(docs/01 十殿表、docs/11 §2.2);五逆直入阿鼻(九殿,docs/11 §3.3)。 */
export const OFFENCES_BY_COURT: readonly { court: number; offences: readonly string[] }[] = [
  { court: 2, offences: ["ABDUCTION", "SEIZING_PROPERTY", "MAIMING"] },
  { court: 3, offences: ["DEFYING_ELDERS", "INCITING_LITIGATION", "BETRAYING_TRUST"] },
  { court: 4, offences: ["WITHHOLDING_DUES", "TRADE_FRAUD"] },
  { court: 5, offences: ["RESENTMENT", "INGRATITUDE", "ENVY", "MISERLINESS"] },
  { court: 6, offences: ["CURSING_HEAVEN", "SACRILEGE", "DISRESPECTING_SCRIPT"] },
  { court: 7, offences: ["BONES_FOR_MEDICINE", "SEPARATING_KIN"] },
  { court: 8, offences: ["NEGLECTING_PARENTS", "UNBURIED_PARENTS"] },
  { court: 9, offences: ["MURDER", "ARSON", "POISONING", "FIVE_HEINOUS"] },
];

export function offenceCourt(offence: string | null | undefined): number | null {
  return OFFENCES_BY_COURT.find((g) => g.offences.includes(offence ?? ""))?.court ?? null;
}

export const WRONGFUL_DEATH_CAUSES = ["ACCIDENT", "VICTIM", "SUICIDE", "WAR", "OTHER"] as const;
export const GRIEVANCE_LEVELS = ["NONE", "MINOR", "MAJOR", "SEVERE"] as const;
/** 申诉属实即提前释放,只在这两级(docs/10 §4.2「冤情重大」;后端 `GRIEVANCE_RELEASE_LEVELS`)。 */
export const GRIEVANCE_RELEASE_LEVELS: readonly string[] = ["MAJOR", "SEVERE"];
