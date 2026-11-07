"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { judgmentApi } from "@soulledger/core/api";
import type { JudgmentAnnual } from "@soulledger/core/api/judgment";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { CIVILIZATION_SHORT_CODES } from "@soulledger/core/config/civilizations";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { Button } from "@/src/components/ui/Button";
import { CaseNumber, MissingValue } from "@/src/components/ui/DomainValue";
import { Skeleton } from "@/components/ui/skeleton";
import { CivEmblem } from "@/src/components/brand/CivEmblem";
import type { SealCiv } from "@/src/components/plaque/Seal";
import { CHART_STROKE, TREND_TOKENS } from "@/lib/chart-colors";

/**
 * 冥界年报(规范 v4 第八批 S14,`annual.*`):一页往下读 —— 这一年收了多少灵魂、几个有了去处;四本账各收多少;
 * 最久的一件、被引用最多的条文、退回重审率;每个月结案(本年实线、上一年虚线);「明年见」。
 * 数全部来自 `GET /judgment/annual/?year=`(`backend/apps/judgment/annual.py` 写着每个数怎么算),年按殿的时区。
 *
 * 一殿的官员只看得到本殿,导语用 `annual.lead_hall`(「本殿」);跨殿的管理员用定稿的 `annual.lead`(「四个冥界」)。
 * 定稿右上的「{年} · 演示站录制数据」只在演示站写;真站只写年。
 */

const CARD =
  "v4-card relative min-w-0 rounded-panel border border-[oklch(var(--color-line))] bg-[oklch(var(--color-surface-1))] p-6";
const MUTED = "text-sm text-[oklch(var(--color-ink-muted))]";
const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === "1";

/** 「{before}{n}{after}」:n 单独上色,词序归语言包(同 HallOverview 的 OverdueLine)。 */
function withNumber(text: string, n: React.ReactNode) {
  const [before, after = ""] = text.split("\u0000");
  return (
    <>
      {before}
      {n}
      {after}
    </>
  );
}

function Civs({ data }: { data: JudgmentAnnual }) {
  const { t } = useI18n();
  const max = Math.max(1, ...data.by_civ.map((c) => c.received));
  return (
    <ul data-annual-civs="" className="m-0 flex list-none flex-col gap-4 p-0">
      {data.by_civ.map(({ civilization, received }) => {
        const skin = CIVILIZATION_SHORT_CODES[civilization] as SealCiv | undefined;
        return (
          <li key={civilization} data-civ={skin} data-annual-civ={civilization} className="grid grid-cols-[28px_8rem_1fr_4rem] items-center gap-3">
            {skin ? <CivEmblem civ={skin} size={28} /> : <span />}
            <span className="text-md font-normal text-[oklch(var(--color-ink))]">{t(`souls.civilizations.${civilization}`)}</span>
            <span aria-hidden="true" className="relative h-2 rounded-control bg-[oklch(var(--color-line))]">
              <span
                className="absolute inset-y-0 left-0 rounded-control bg-[oklch(var(--color-main-ink))]"
                style={{ width: `${(received / max) * 100}%` }}
              />
            </span>
            <span className="text-right font-mono text-lg font-normal tabular-nums text-[oklch(var(--color-ink))]">{received}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Fact({ label, value, note, testid }: { label: string; value: React.ReactNode; note?: React.ReactNode; testid: string }) {
  return (
    <div data-annual-fact={testid} className={CARD}>
      <div className={MUTED}>{label}</div>
      <div className="mt-2 font-title text-xl font-semibold tabular-nums text-[oklch(var(--color-ink))]">{value}</div>
      {note && <div className={`mt-1 ${MUTED}`}>{note}</div>}
    </div>
  );
}

function returnedNote(t: (k: string, p?: Record<string, string>) => string, now: number | null, last: number | null) {
  if (now == null || last == null || now === last) return undefined;
  const n = Math.abs(now - last).toFixed(1);
  return t(now < last ? "annual.returned_down" : "annual.returned_up", { n });
}

const W = 600;
const H = 120;

/** 每月结案:本年实线(文明字色)、上一年虚线(金属色),与概览「近 12 周」同一套笔画(`CHART_STROKE` / `TREND_TOKENS`)。 */
function Monthly({ data }: { data: JudgmentAnnual }) {
  const { t } = useI18n();
  const max = Math.max(1, ...data.monthly, ...data.last_year_monthly);
  const x = (k: number) => (k / 11) * W;
  const y = (v: number) => H - 4 - (v / max) * (H - 12);
  const line = (values: number[]) => values.map((v, k) => `${x(k).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  return (
    <figure data-annual-monthly="" className="m-0">
      <svg role="img" aria-labelledby="annual-monthly-title" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-32 w-full overflow-visible">
        <line x1="0" y1={H - 1} x2={W} y2={H - 1} strokeWidth={CHART_STROKE.axis} vectorEffect="non-scaling-stroke" className="stroke-[oklch(var(--color-line))]" />
        <polyline
          data-series="previous"
          points={line(data.last_year_monthly)}
          fill="none"
          strokeWidth={CHART_STROKE.line}
          strokeDasharray={CHART_STROKE.dash}
          vectorEffect="non-scaling-stroke"
          style={{ stroke: `oklch(var(${TREND_TOKENS.previous}))` }}
        />
        <polyline
          data-series="current"
          points={line(data.monthly)}
          fill="none"
          strokeWidth={CHART_STROKE.line}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          style={{ stroke: `oklch(var(${TREND_TOKENS.current}))` }}
        />
      </svg>
      <div aria-hidden="true" className="mt-2 grid grid-cols-12 font-mono text-xs text-[oklch(var(--color-ink-muted))]">
        {data.monthly.map((_, k) => (
          <span key={k} className={k === 0 ? "text-left" : k === 11 ? "text-right" : "text-center"}>{k + 1}</span>
        ))}
      </div>
      <figcaption className="mt-2 flex gap-4 text-xs text-[oklch(var(--color-ink-muted))]">
        <span><span aria-hidden="true" style={{ color: `oklch(var(${TREND_TOKENS.current}))` }}>━ </span>{t("annual.this_year")}</span>
        <span><span aria-hidden="true" style={{ color: `oklch(var(${TREND_TOKENS.previous}))` }}>┅ </span>{t("annual.last_year")}</span>
      </figcaption>
      {/* 读屏的文字替代:十二个月两行数。 */}
      <table className="sr-only">
        <caption>{t("annual.monthly")}</caption>
        <tbody>
          <tr><th scope="row">{t("annual.this_year")}</th>{data.monthly.map((v, k) => <td key={k}>{v}</td>)}</tr>
          <tr><th scope="row">{t("annual.last_year")}</th>{data.last_year_monthly.map((v, k) => <td key={k}>{v}</td>)}</tr>
        </tbody>
      </table>
    </figure>
  );
}

export function AnnualReport() {
  const { t } = useI18n();
  const { user } = useTenant();
  const [year, setYear] = useState<number | undefined>(undefined);
  const q = useQuery({
    queryKey: [...judgmentKeys.all, "annual", year ?? "current"],
    queryFn: async () => (await judgmentApi.annual(year)).data,
    staleTime: 60_000,
  });
  const data = q.data;
  const lead = user?.tenant ? t("annual.lead_hall") : t("annual.lead");

  return (
    <div data-annual="" className="flex flex-col gap-8">
      <div className="flex flex-wrap items-center gap-3">
        <span data-annual-year="" className="font-mono text-sm text-[oklch(var(--color-ink-muted))]">
          {data ? (IS_DEMO ? t("annual.data_note", { year: String(data.year) }) : data.year) : null}
        </span>
        <span className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={!data} onClick={() => data && setYear(data.year - 1)}>
            {t("annual.last_year")}
          </Button>
          {year !== undefined && (
            <Button type="button" size="sm" variant="ghost" onClick={() => setYear(undefined)}>
              {t("annual.this_year")}
            </Button>
          )}
        </span>
      </div>

      {q.isError ? (
        <div className="flex items-center gap-3">
          <span role="alert" className="text-sm text-[oklch(var(--color-danger))]">
            <span aria-hidden="true">✕ </span>
            {t("dashboard.error_load")}
          </span>
          <Button type="button" size="sm" variant="secondary" onClick={() => void q.refetch()}>
            {t("common.retry")}
          </Button>
        </div>
      ) : !data ? (
        <div className="space-y-4">
          <Skeleton className="h-23 w-48" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : (
        <>
          <section data-annual-lead="">
            <div className="text-md font-normal text-[oklch(var(--color-ink-muted))]">{lead}</div>
            <div data-annual-received="" className="font-title text-display-xl tabular-nums text-[oklch(var(--color-ink))]">
              {data.received}
            </div>
            <div className="text-lg font-normal text-[oklch(var(--color-ink))]">
              {withNumber(
                t("annual.total_rest", { m: "\u0000" }),
                <span data-annual-placed="" className="font-semibold text-[oklch(var(--color-metal))]">{data.placed}</span>,
              )}
            </div>
          </section>

          {data.by_civ.length > 0 && (
            <section className="grid gap-6 md:grid-cols-[18rem_1fr]">
              <h2 className="m-0 font-title text-lg text-[oklch(var(--color-ink))]">{t("annual.by_civ")}</h2>
              <Civs data={data} />
            </section>
          )}

          <section className="grid gap-4 md:grid-cols-3">
            <Fact
              testid="longest"
              label={t("annual.longest")}
              value={data.longest ? t("annual.longest_value", { n: String(data.longest.days) }) : <MissingValue kind="inapplicable" />}
              note={
                data.longest && (
                  <>
                    <CaseNumber value={data.longest.case_number} variant="inline" /> · {data.longest.soul_name}
                  </>
                )
              }
            />
            <Fact
              testid="most-cited"
              label={t("annual.most_cited")}
              value={data.most_cited ? `§ ${data.most_cited.ordinal} / ${data.most_cited.corpus_size}` : <MissingValue kind="inapplicable" />}
              note={data.most_cited && `${t(`judgment.statute_corpus.${data.most_cited.corpus}`)} · ${data.most_cited.display_title}`}
            />
            <Fact
              testid="returned"
              label={t("overview.stat.returned")}
              value={data.returned_pct == null ? <MissingValue kind="inapplicable" /> : `${data.returned_pct.toFixed(1)}%`}
              note={returnedNote(t, data.returned_pct, data.last_year_returned_pct)}
            />
          </section>

          <section className={CARD}>
            <h2 id="annual-monthly-title" className="m-0 mb-4 font-title text-lg text-[oklch(var(--color-ink))]">{t("annual.monthly")}</h2>
            <Monthly data={data} />
          </section>

          <p className="m-0 font-title text-xl font-semibold text-[oklch(var(--color-ink))]">{t("annual.closing")}</p>
        </>
      )}
    </div>
  );
}
