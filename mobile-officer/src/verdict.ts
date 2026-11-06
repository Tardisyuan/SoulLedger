/**
 * 滑卡审判的规则(v4 S09 / S10,Design 第三~六批),不含界面:哪一边被天平挡住、「不过」的理由怎么选、
 * 选到什么程度「不过 · 落印」才可点、发给 `conclude/` 的是什么、判语预览写哪一句。
 *
 * 理由的代码与后端 `backend/apps/judgment/fail_reasons.py` 同一套(文字在 `reject_reason.*`):
 * - 地府:一个罪目或 OTHER;欧洲:恰好一项;希腊:先选文书,再在这套里多选,另加必选的可医 / 不可医;
 * - 埃及:不能选,理由由天平与 42 条否定告白列出(发 `fail_reasons` 或一句话都会被拒,所以这里也没有「其他」)。
 * 希腊判 PASSED 也要选文书(`greek_account_required`)。
 */
import type { ConcludeJudgmentPayload, GreekAccount, GreekCurability, JudgmentDetail } from "@soulledger/core/api/judgment";
import type { Locale } from "@soulledger/core/config/locale";
import { isDuatBarred, isHeldUntilFatedDate } from "@soulledger/core/domain/dates";
import { offenceCourt } from "@soulledger/core/domain/diyuCase";

type T = (key: string, vars?: Record<string, string>) => string;
export type Side = "left" | "right";

export const OTHER = "OTHER";
/**
 * 地府手机上先列的 4 条。定稿要按这位官员的使用频率排(第六批 ⑧),后端还没有这个数;
 * 没有记录时定稿用的就是这 4 条。ponytail: 固定顺序,有了按官员统计罪目的接口再换。
 */
export const CN_TOP = ["TRADE_FRAUD", "DEFYING_ELDERS", "SEIZING_PROPERTY", "MURDER"] as const;
export const EU_REASONS = ["MORTAL_SIN", "DENIED_IMMORTALITY", "NEUTRAL"] as const;
export const GR_ACCOUNTS: readonly GreekAccount[] = ["GORGIAS", "REPUBLIC"];
export const GR_REASONS: Record<GreekAccount, readonly string[]> = {
  GORGIAS: ["PERJURY", "INJUSTICE"],
  REPUBLIC: ["MANY_DEATHS", "BETRAYAL", "ENSLAVEMENT"],
};
/** 否认灵魂不灭落第 6 圈(第六批 ④;后端 disposition/services.py)。 */
export const DENIED_IMMORTALITY_CIRCLE = 6;
/** 左右滑过这个比例的宽度才算数(第三批「过 35% 宽度」)。 */
export const SWIPE_FRACTION = 0.35;
/** 被天平挡住的方向只拖得出这么远(第六批)。 */
export const BLOCKED_DRAG = 14;

export interface RejectChoice {
  reasons: string[];
  note: string;
  account: "" | GreekAccount;
  curability: "" | GreekCurability;
}
export const NO_CHOICE: RejectChoice = { reasons: [], note: "", account: "", curability: "" };

/** 埃及:天平判了通过就挡左滑(不过),判了不过就挡右滑(通过);别的文明、还没称出结果的都不挡。 */
export function blockedSide(j: Pick<JudgmentDetail, "civilization" | "admitted_balance">): Side | null {
  if (j.civilization !== "EGYPTIAN") return null;
  const weighed = j.admitted_balance?.weighing?.weighed_verdict;
  return weighed === "PASSED" ? "left" : weighed === "FAILED" ? "right" : null;
}

/** 点一项:地府、欧洲只能一项(换掉);希腊可多选(再点取消)。换文书时清掉另一套的理由。 */
export function toggleReason(civ: string, c: RejectChoice, code: string): RejectChoice {
  if (civ !== "GREEK") return { ...c, reasons: c.reasons[0] === code ? [] : [code] };
  return { ...c, reasons: c.reasons.includes(code) ? c.reasons.filter((r) => r !== code) : [...c.reasons, code] };
}

export function chooseAccount(c: RejectChoice, account: GreekAccount): RejectChoice {
  return account === c.account ? c : { ...c, account, reasons: c.reasons.filter((r) => r === OTHER) };
}

/** 「不过 · 落印」可点了吗(没选全时是灰的,S10)。 */
export function rejectReady(civ: string, c: RejectChoice): boolean {
  if (civ === "EGYPTIAN") return true;
  const otherOk = !c.reasons.includes(OTHER) || c.note.trim() !== "";
  if (civ === "GREEK") return !!c.account && !!c.curability && c.reasons.length > 0 && otherOk;
  return c.reasons.length === 1 && otherOk;
}

export function failPayload(civ: string, c: RejectChoice): ConcludeJudgmentPayload {
  if (civ === "EGYPTIAN") return { verdict: "FAILED" };
  return {
    verdict: "FAILED",
    fail_reasons: c.reasons,
    fail_reason_note: c.reasons.includes(OTHER) ? c.note.trim() : "",
    ...(civ === "GREEK" ? { greek_account: c.account, greek_curability: c.curability } : {}),
  };
}

export function passPayload(civ: string, account: "" | GreekAccount = ""): ConcludeJudgmentPayload {
  return civ === "GREEK" ? { verdict: "PASSED", greek_account: account } : { verdict: "PASSED" };
}

const HAN = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
/** 殿号:中文写汉字(「四殿」「第四殿」,定稿如此),别的语言写数字。 */
export function courtNumeral(n: number, locale: Locale): string {
  return locale === "zh-Hans" && n >= 0 && n <= 10 ? HAN[n] : String(n);
}

/** 判语预览(`verdict_doc.*.verdict.*`);说不出去处的(地府「其他」、欧洲中立者以外、希腊未选标记)为 null。 */
export function previewOf(t: T, civ: string, c: RejectChoice, locale: Locale): string | null {
  const first = c.reasons[0];
  if (civ === "EGYPTIAN") return t("verdict_doc.eg.verdict.fail");
  if (civ === "CHINESE") {
    if (first === "FIVE_HEINOUS") return t("verdict_doc.cn.verdict.five_heinous");
    const court = offenceCourt(first);
    return court ? t("verdict_doc.cn.verdict.fail", { offence: t(`judgment.offences.${first}`), n: courtNumeral(court, locale) }) : null;
  }
  // 欧洲:只有中立者有一句现成的判语。大罪的圈号要等选殿算出来;否认灵魂不灭的去处(第 6 圈)写在选项上,
  // 不借「有未悔的大罪」那一句 —— 那会说一件理由没说的事。
  if (civ === "EUROPEAN") return first === "NEUTRAL" ? t("verdict_doc.eu.verdict.antinferno") : null;
  if (civ === "GREEK" && c.curability) {
    const mark = c.curability === "INCURABLE" ? "incurable" : "curable";
    if (c.account === "GORGIAS") return t(`verdict_doc.gr.verdict.${mark}`);
    if (c.account === "REPUBLIC") return t(mark === "incurable" ? "verdict_doc.gr_er.verdict.incurable" : "verdict_doc.gr_er.verdict.unjust");
  }
  return null;
}

const DAY = 86_400;
/** 卡片上的「已等 n 天」:从可认领起算,没有就从立案起算。 */
export function waitedDays(j: { claimable_since?: string | null; created_at: string }, now = Date.now()): number {
  const since = Date.parse(j.claimable_since ?? j.created_at);
  return Number.isNaN(since) ? 0 : Math.max(0, Math.floor((now - since) / (DAY * 1000)));
}

/** 还在候审:还到不了可认领的那天(枉死城候至阳寿、埃及入殿前、城隍未解送 …),期限还没开始。 */
export function heldBeforeClaim(j: { conclude_refusal?: string | null; held_until?: string | null; duat_stage?: string | null }): boolean {
  return !!j.conclude_refusal || isHeldUntilFatedDate(j) || isDuatBarred(j);
}

/**
 * 期限一格(`queue.deadline.*`):不计 / n 日 / 超 n 日。待定中停表,仍照剩下的写。
 * 候审中的写「候审中 · 不计期限」:服务端从可认领那天起算(`claimable_since` = `held_until`),
 * 候至 2056 年的案子按剩下的写就是「10956 日」(安卓真机 2026-11-06)。
 */
export function deadlineText(
  t: T,
  j: { deadline_remaining_seconds?: number | null; conclude_refusal?: string | null; held_until?: string | null; duat_stage?: string | null }
): string {
  if (heldBeforeClaim(j)) return t("queue.deadline.held");
  const s = j.deadline_remaining_seconds;
  if (s == null) return t("queue.deadline.none");
  if (s < 0) return t("queue.deadline.over", { n: String(Math.ceil(-s / DAY)) });
  return t("queue.deadline.days", { n: String(Math.ceil(s / DAY)) });
}
