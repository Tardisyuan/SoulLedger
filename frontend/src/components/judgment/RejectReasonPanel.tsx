"use client";

import { useId, useState } from "react";
import type { ConcludeJudgmentPayload } from "@soulledger/core/api";
import type { GreekAccount, GreekCurability } from "@soulledger/core/api/judgment";
import { OFFENCES_BY_COURT, offenceCourt } from "@soulledger/core/domain/diyuCase";
import { useI18n } from "@/src/contexts/I18nContext";

/**
 * 「不过」的理由面板(规范 v4 第七批 S10,第五、六批定稿),画在盖印确认层的第 1 步里。
 *
 * 规则与后端 `backend/apps/judgment/fail_reasons.py::check`(经结案接口、原审)一一对应,这里只是先拦:
 * - 地府、欧洲、希腊判「不过」必选理由;地府与欧洲恰好一项,希腊可多选。选「其他」要写一句(至多 500 字)。
 * - 欧洲的「否认灵魂不灭」「登记为中立者」读灵魂登记里的事实,登记没有就不能选(`fail_reason_contradicts_record`)。
 *   这里不列七宗罪:七宗罪对应炼狱七台(docs/03),不对应地狱九圈,而「不过」是下地狱(用户 2026-11-07)。
 * - 希腊判「通过」或「不过」都先选文书(D8:《高尔吉亚》/《理想国》),「不过」再加上必选的可医 / 不可医(D7)。
 *   不可医 = 塔尔塔罗斯、永罚,页面据此不再带去处与年数(`incurable_is_eternal_in_tartarus`)。
 * - 埃及不能选:理由由天平与否定告白列出(`reject.sheet.eg_auto`),只读列出记为「不实」的告白。
 *
 * 没选够时页面把「不过 · 落印」置灰(`reasonsReady`)。落印不可撤回。
 */

export interface ReasonDraft {
  reasons: string[];
  note: string;
  account: "" | GreekAccount;
  curability: "" | GreekCurability;
}

export const EMPTY_REASONS: ReasonDraft = { reasons: [], note: "", account: "", curability: "" };

const OTHER = "OTHER";
const NOTE_MAX = 500;
const EUROPEAN = ["MORTAL_SIN", "DENIED_IMMORTALITY", "NEUTRAL", OTHER] as const;
const GREEK: Record<GreekAccount, readonly string[]> = {
  GORGIAS: ["PERJURY", "INJUSTICE", OTHER],
  REPUBLIC: ["MANY_DEATHS", "BETRAYAL", "ENSLAVEMENT", OTHER],
};
/** 地府先列的 4 条(第六批 ⑧):没有按官员统计的使用次数(C8),一律用定稿给的这一组。 */
const CN_TOP = ["TRADE_FRAUD", "DEFYING_ELDERS", "SEIZING_PROPERTY", "MURDER"] as const;
const CN_ALL = OFFENCES_BY_COURT.flatMap((g) => g.offences);
/** 「否认灵魂不灭」落第 6 圈(docs,`disposition/services.py`)。 */
const HERESY_CIRCLE = 6;

const greek = (civ: string) => civ === "GREEK";
const single = (civ: string) => civ === "CHINESE" || civ === "EUROPEAN";

/** 原审的这一判要不要画面板:四文明判「不过」(埃及只读),希腊判「通过」要选文书。 */
export function reasonsShown(civ: string, verdict: string): boolean {
  if (verdict === "FAILED") return ["CHINESE", "EUROPEAN", "GREEK", "EGYPTIAN"].includes(civ);
  return greek(civ) && verdict === "PASSED";
}

/** 后端 `check(required=True)` 的同一组条件:不满足就不能落印。 */
export function reasonsReady(civ: string, verdict: string, d: ReasonDraft): boolean {
  if (!reasonsShown(civ, verdict)) return true;
  if (greek(civ) && !d.account) return false;
  if (verdict !== "FAILED" || civ === "EGYPTIAN") return true;
  if (d.reasons.length === 0 || (single(civ) && d.reasons.length !== 1)) return false;
  if (d.reasons.includes(OTHER) && !d.note.trim()) return false;
  if (d.note.length > NOTE_MAX) return false;
  return !greek(civ) || !!d.curability;
}

/** 结案请求里理由与希腊标记那几项;不画面板时什么都不带。 */
export function reasonPayload(civ: string, verdict: string, d: ReasonDraft): Partial<ConcludeJudgmentPayload> {
  if (!reasonsShown(civ, verdict)) return {};
  const out: Partial<ConcludeJudgmentPayload> = {};
  if (greek(civ)) out.greek_account = d.account;
  if (verdict === "FAILED" && civ !== "EGYPTIAN") {
    out.fail_reasons = d.reasons;
    if (d.reasons.includes(OTHER)) out.fail_reason_note = d.note.trim();
    if (greek(civ)) out.greek_curability = d.curability;
  }
  return out;
}

/** 不可医者永罚于塔尔塔罗斯:页面不再带去处、年数、永久与否。 */
export const isIncurable = (civ: string, verdict: string, d: ReasonDraft) =>
  greek(civ) && verdict === "FAILED" && d.curability === "INCURABLE";

const ZH_NUMERALS = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

const OPTION =
  "flex min-h-(--control-h-sm) cursor-pointer items-center gap-2 border border-[oklch(var(--color-line))] px-3 text-sm text-[oklch(var(--color-ink))] has-checked:border-[oklch(var(--color-ink))] has-checked:font-semibold has-disabled:cursor-not-allowed has-disabled:opacity-40";

export function RejectReasonPanel({
  civilization,
  verdict,
  soulName,
  value,
  onChange,
  deniedImmortality,
  neutralInLife,
  falseConfessions = [],
}: {
  civilization: string;
  verdict: string;
  soulName: string;
  value: ReasonDraft;
  onChange: (next: ReasonDraft) => void;
  /** 灵魂登记里的两个事实(欧洲两项理由读它们);没登记 = 不能选。 */
  deniedImmortality?: boolean | null;
  neutralInLife?: boolean | null;
  /** 埃及:记为「不实」的否定告白(序号与原文)。 */
  falseConfessions?: readonly { ordinal: number; text: string }[];
}) {
  const { t, locale } = useI18n();
  const base = useId();
  const [more, setMore] = useState(() => value.reasons.some((r) => !(CN_TOP as readonly string[]).includes(r) && r !== OTHER));
  if (!reasonsShown(civilization, verdict)) return null;
  const failing = verdict === "FAILED";
  const isGreek = greek(civilization);
  const courtNo = (n: number) => (locale === "zh-Hans" ? ZH_NUMERALS[n] : String(n));

  const pick = (code: string, on: boolean) => {
    const reasons = single(civilization) ? (on ? [code] : []) : on ? [...value.reasons, code] : value.reasons.filter((r) => r !== code);
    onChange({ ...value, reasons, note: reasons.includes(OTHER) ? value.note : "" });
  };
  const recordLacks = (code: string) =>
    (code === "DENIED_IMMORTALITY" && !deniedImmortality) || (code === "NEUTRAL" && !neutralInLife);

  const choice = (code: string, label: string, aside?: string) => {
    const lacks = civilization === "EUROPEAN" && recordLacks(code);
    return (
      <label key={code} className={OPTION} title={lacks ? t("judgment.fail_reason_errors.fail_reason_contradicts_record") : undefined}>
        <input
          type={single(civilization) ? "radio" : "checkbox"}
          name={`${base}-reason`}
          value={code}
          checked={value.reasons.includes(code)}
          disabled={lacks}
          onChange={(event) => pick(code, event.target.checked)}
          className="h-4 w-4 shrink-0 accent-[oklch(var(--color-ink))]"
        />
        <span className="min-w-0 flex-1">{label}</span>
        {aside && <span className="shrink-0 font-mono text-2xs text-[oklch(var(--color-ink-subtle))]">{aside}</span>}
      </label>
    );
  };
  const offence = (code: string) => {
    const court = offenceCourt(code);
    return choice(code, t(`judgment.offences.${code}`), court ? t("reject_reason.cn.court", { n: courtNo(court) }) : undefined);
  };

  const scope =
    civilization === "EUROPEAN"
      ? t("reject.sheet.eu_scope")
      : civilization === "EGYPTIAN"
        ? t("reject.sheet.eg_auto")
        : isGreek && value.account === "REPUBLIC"
          ? t("map.greece.thousand_year_cycle")
          : isGreek && value.account === "GORGIAS"
            ? t("reject.sheet.gr_scars")
            : null;

  const options = (() => {
    if (!failing) return null;
    if (civilization === "CHINESE") {
      return (
        <>
          <p className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
            {more ? t("reject.sheet.by_court") : t("reject.sheet.cn_top", { n: String(CN_TOP.length) })}
          </p>
          {more
            ? OFFENCES_BY_COURT.map((g) => (
                <div key={g.court} role="group" aria-label={t("reject_reason.cn.court", { n: courtNo(g.court) })} className="grid gap-1">
                  {g.offences.map(offence)}
                </div>
              ))
            : CN_TOP.map(offence)}
          {!more && (
            <button
              type="button"
              onClick={() => setMore(true)}
              className="flex min-h-(--control-h-sm) items-center justify-between border border-dashed border-[oklch(var(--color-line))] px-3 text-sm text-[oklch(var(--color-ink-muted))] hover:text-[oklch(var(--color-ink))]"
            >
              {t("nav.more")}
              <span className="font-mono text-2xs">{t("reject.sheet.cn_more_sub", { n: String(CN_ALL.length) })}</span>
            </button>
          )}
          {choice(OTHER, t("reject_reason.other"))}
        </>
      );
    }
    if (civilization === "EUROPEAN") {
      return EUROPEAN.map((code) =>
        code === "MORTAL_SIN" ? (
          choice(code, t("reject_reason.eu.mortal_sin"))
        ) : code === "DENIED_IMMORTALITY" ? (
          choice(code, t("souls.denied_immortality.label"), t("reject.sheet.circle", { n: String(HERESY_CIRCLE) }))
        ) : code === "NEUTRAL" ? (
          choice(code, t("reject_reason.eu.neutral"))
        ) : (
          choice(code, t("reject_reason.other"))
        ),
      );
    }
    if (isGreek) {
      if (!value.account) return null;
      return GREEK[value.account].map((code) =>
        choice(
          code,
          code === OTHER
            ? t(value.account === "REPUBLIC" ? "reject_reason.gr_er.other" : "reject_reason.other")
            : t(`reject_reason.${value.account === "REPUBLIC" ? "gr_er" : "gr"}.${code.toLowerCase()}`),
        ),
      );
    }
    // 埃及:只读。
    return falseConfessions.map((c) => (
      <div key={c.ordinal} data-testid="reject-false-confession" className="border border-[oklch(var(--color-line))] px-3 py-2 text-sm">
        <p className="font-semibold text-[oklch(var(--color-ink))]">{t("reject_reason.eg.false_confession", { n: String(c.ordinal) })}</p>
        <p className="mt-1 font-serif text-[oklch(var(--color-ink-muted))]">{c.text}</p>
      </div>
    ));
  })();

  const preview = (() => {
    // 希腊判「通过」(第十一批第 3 条):第五批定稿的判语,随所选的一篇换。
    if (!failing) {
      if (value.account === "GORGIAS") return t("verdict_doc.gr.verdict.isles");
      if (value.account === "REPUBLIC") return t("verdict_doc.gr_er.verdict.just");
      return null;
    }
    if (civilization === "EGYPTIAN") return t("verdict_doc.eg.verdict.fail");
    const r = value.reasons.length === 1 ? value.reasons[0] : null;
    if (civilization === "CHINESE" && r && r !== OTHER) {
      if (r === "FIVE_HEINOUS") return t("verdict_doc.cn.verdict.five_heinous");
      const court = offenceCourt(r);
      return court ? t("verdict_doc.cn.verdict.fail", { offence: t(`judgment.offences.${r}`), n: courtNo(court) }) : null;
    }
    if (civilization === "EUROPEAN") {
      if (r === "DENIED_IMMORTALITY") return t("verdict_doc.eu.verdict.heresy");
      if (r === "NEUTRAL") return t("verdict_doc.eu.verdict.antinferno");
      return null; // 大罪的圈号由发落定,这里不猜
    }
    if (isGreek && value.curability) {
      if (value.account === "GORGIAS") return t(`verdict_doc.gr.verdict.${value.curability === "INCURABLE" ? "incurable" : "curable"}`);
      if (value.account === "REPUBLIC") return t(value.curability === "INCURABLE" ? "verdict_doc.gr_er.verdict.incurable" : "verdict_doc.gr_er.verdict.unjust");
    }
    return null;
  })();

  const otherChosen = value.reasons.includes(OTHER);

  return (
    <section data-testid="reject-reasons" aria-labelledby={`${base}-title`} className="grid gap-3 text-left">
      <h3 id={`${base}-title`} className="font-title text-lg text-[oklch(var(--color-ink))]">
        {failing ? t("reject.sheet.title") : t("judgment.greek_account_label")}
      </h3>
      <p className="text-xs text-[oklch(var(--color-ink-muted))]">
        {t("reject.sheet.unstamped", { soul: soulName })}
        {failing && scope && ` · ${scope}`}
      </p>
      {isGreek && !failing && <p className="text-sm text-[oklch(var(--color-ink-muted))]">{t("judgment.greek_account.why")}</p>}
      {isGreek && (
        <div role="radiogroup" aria-label={t("judgment.greek_account_label")} data-testid="greek-account" className={failing ? "grid grid-cols-2 gap-2" : "grid gap-2"}>
          {(["GORGIAS", "REPUBLIC"] as const).map((account) => (
            <label key={account} className={OPTION}>
              <input
                type="radio"
                name={`${base}-account`}
                value={account}
                checked={value.account === account}
                // 换文书,理由随之作废(两篇的理由不同)。
                onChange={() => onChange({ ...value, account, reasons: [], note: "" })}
                className="h-4 w-4 shrink-0 accent-[oklch(var(--color-ink))]"
              />
              <span className="min-w-0">
                <span className="block">{t(account === "GORGIAS" ? "judgment.greek_account.gorgias" : "judgment.greek_account.republic")}</span>
                {/* 通过时每一篇下面写它把灵魂送到哪里(第五批判决文书的题名)。 */}
                {!failing && (
                  <span className="block text-xs font-normal text-[oklch(var(--color-ink-muted))]">
                    {t(account === "GORGIAS" ? "judgment.greek_account.gorgias_pass" : "judgment.greek_account.republic_pass")}
                  </span>
                )}
              </span>
            </label>
          ))}
        </div>
      )}
      {options && <div className="grid gap-1">{options}</div>}
      {failing && isGreek && value.account && (
        <div role="radiogroup" aria-label={t("reject_reason.gr.mark")} data-testid="greek-curability" className="grid gap-1">
          <p className="text-2xs uppercase text-[oklch(var(--color-ink-subtle))]">
            {t("reject_reason.gr.mark")} · {t("reject.sheet.required")}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(["CURABLE", "INCURABLE"] as const).map((mark) => (
              <label key={mark} className={OPTION}>
                <input
                  type="radio"
                  name={`${base}-curability`}
                  value={mark}
                  checked={value.curability === mark}
                  onChange={() => onChange({ ...value, curability: mark })}
                  className="h-4 w-4 shrink-0 accent-[oklch(var(--color-ink))]"
                />
                {t(mark === "CURABLE" ? "reject_reason.gr.curable" : "reject_reason.gr.incurable")}
              </label>
            ))}
          </div>
        </div>
      )}
      {otherChosen && (
        <textarea
          aria-label={t("reject_reason.other")}
          data-testid="reject-note"
          value={value.note}
          maxLength={NOTE_MAX}
          rows={2}
          onChange={(event) => onChange({ ...value, note: event.target.value })}
          className="block w-full rounded-control border border-[oklch(var(--color-line-strong))] bg-[oklch(var(--color-surface-1))] px-3 py-2 text-sm text-[oklch(var(--color-ink))]"
        />
      )}
      {preview && (
        <p data-testid="reject-preview" className="border-t border-[oklch(var(--color-line))] pt-3 text-sm text-[oklch(var(--color-ink))]">
          <span className="text-[oklch(var(--color-ink-subtle))]">{t("reject.sheet.preview_label")} · </span>
          <span className="font-serif">{preview}</span>
        </p>
      )}
    </section>
  );
}
