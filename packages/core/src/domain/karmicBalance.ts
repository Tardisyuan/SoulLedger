import { civShortCode } from "../config/civilizations";

/**
 * 「余额」(`karmic_balance`,功 − 过)只对地府成立:相抵是功过格的读法,埃及称心、欧洲补赎都不相抵
 * (`frontend/src/components/souls/SoulKarmaLedgerCard.tsx` 余额那一行的长注释)。
 * 网页的灵魂列表、预览抽屉与官员 App 的灵魂页头都按这一条画或不画余额(用户 2026-11-08)。
 * `civilization`:`CHINESE` 或租户代码 `CN_DIYU` 都认。
 */
export function balanceApplies(civilization: string | null | undefined): boolean {
  return civShortCode(civilization) === "cn";
}
