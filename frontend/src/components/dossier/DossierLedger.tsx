"use client";

import Link from "next/link";
import type { LedgerRecord } from "@soulledger/core/api";
import { formatHistoricalDate, formatListDate } from "@soulledger/core/domain/dates";
import { useI18n } from "@/src/contexts/I18nContext";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { MeritMark, SignedNumber } from "./MeritMark";
import s from "./dossier.module.css";

/**
 * 卷里的「功过」(Design 第三十批 第 3 步第 1、4 条):头一行是两枚记号各带条数与净额,右边「全部 N 条 →」;
 * 下面最近几条,每行 日期 · 记号 · 事由 · 带号的数(颜色只上数字)。数读 `/souls/{id}/karma/`,
 * 与灵魂账页同一个端点;权重为 null(观察员看不到)时数那一格写「未记录」。
 */
export function DossierLedger({
  civilization,
  records,
  merit,
  demerit,
  allHref,
  limit = 5,
}: {
  civilization: string | null | undefined;
  records: readonly LedgerRecord[] | undefined;
  merit?: number | null;
  demerit?: number | null;
  allHref?: string;
  limit?: number;
}) {
  const { t, locale } = useI18n();
  const rows = (records ?? []).filter((r) => r.type === "MERIT" || r.type === "DEMERIT");
  const net = merit != null && demerit != null ? merit - demerit : null;
  const shown = [...rows].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at)).slice(0, limit);
  return (
    <div data-testid="dossier-ledger">
      <p className={s.juanHead}>
        {t("caseDesk.juan.merits")}
        <MeritMark civilization={civilization} kind="merit" />
        <span className={s.num}>{merit ?? "–"}</span>
        <span aria-hidden="true">·</span>
        <MeritMark civilization={civilization} kind="demerit" />
        <span className={s.num}>{demerit ?? "–"}</span>
        {net != null && (
          <>
            <span aria-hidden="true">·</span>
            {t("caseDesk.juan.net")} <SignedNumber value={net} />
          </>
        )}
        {allHref && rows.length > 0 && <Link href={allHref} className="underline underline-offset-2">{`${t("caseDesk.dossier.merits_all", { n: String(rows.length) })} →`}</Link>}
      </p>
      {shown.length === 0 ? (
        <p className={s.juanKey}>{t("caseDesk.juan.recent_none")}</p>
      ) : (
        <div className={s.juan}>
          {shown.map((r) => {
            const kind = r.type === "MERIT" ? "merit" : "demerit";
            const when = r.event_date ? formatHistoricalDate(r.event_date, locale) : formatListDate(r.recorded_at, locale, { time: false });
            return (
              <div key={r.id} className={s.ledgerRow} data-kind={kind}>
                <span className={s.juanKey}>{when ?? <MissingValue kind="unrecorded" />}</span>
                <MeritMark civilization={civilization} kind={kind} />
                <span className={s.juanVal}>{r.description}</span>
                <span>{r.original_weight == null ? <MissingValue kind="unrecorded" /> : <SignedNumber value={r.original_weight} sign={kind === "merit" ? 1 : -1} />}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
