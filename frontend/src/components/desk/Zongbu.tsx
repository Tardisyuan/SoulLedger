"use client";

import Link from "next/link";
import { useQueries, useQuery } from "@tanstack/react-query";
import { judgmentApi } from "@soulledger/core/api/judgment";
import { crossTenantJudgmentsApi, dispatchApi } from "@soulledger/core/api/dispatch";
import { civShortCode } from "@soulledger/core/config/civilizations";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { formatListDate } from "@soulledger/core/domain/dates";
import { useI18n } from "@/src/contexts/I18nContext";
import { useTenant } from "@/src/contexts/TenantContext";
import { buttonVariants } from "@/src/components/ui/Button";
import { Meter } from "@/src/components/ui/Meter";
import { deadlineText, overviewParts, zongbuCivilizations } from "./deskRules";
import { BrandMark } from "@/src/components/brand/BrandMark";
import { DomainEnum } from "@/src/components/ui/DomainValue";
import s from "./desk.module.css";

const TOP = 3;
const CROSS_ROWS = 5;

/**
 * 总簿(Design 第三十批 第 2 步 · 管理员,中性皮):品牌金的顶线与天平水印;四个冥界各一栏 —— 今日待审、超期、前三件;
 * 下面一张「跨界往来」(调拨与跨界会审,各取最近几条)。四栏顶上各一条 2px 文明色线(用户认可的唯一例外;栏上的 data-civ 换五槽)。
 *
 * 只读管理员本来就读得到的:`queue-counts/?civilization=`、`GET /judgment/?civilization=&has_verdict=false`、
 * `hall-stats/`(页头)与 `hall-stats/?civilization=`(每栏的本月已结进度条)、`/dispatch/records/`、
 * `/dispatch/cross-tenant-judgments/`(未了结的会审按开案时间 `create_time` 标「某日起」)。
 * 一栏本月既没结案也没未结的(`month_done_pct` 为 null),照实说没有,不画空条。
 */
export function Zongbu() {
  const { t, locale, formatDateTime } = useI18n();
  const { user } = useTenant();
  // 绑殿的管理员只有本殿一栏(`zongbuCivilizations`)。
  const civs = zongbuCivilizations(user?.tenant);

  const counts = useQueries({
    queries: civs.map((civilization) => ({
      queryKey: judgmentKeys.queueCounts({ civilization }),
      queryFn: async () => (await judgmentApi.queueCounts({ civilization })).data,
    })),
  });
  const tops = useQueries({
    queries: civs.map((civilization) => {
      const params = { civilization, has_verdict: "false", ordering: "created_at" };
      return { queryKey: judgmentKeys.list(params), queryFn: async () => (await judgmentApi.list(params)).data };
    }),
  });
  const stats = useQuery({ queryKey: judgmentKeys.hallStats(), queryFn: async () => (await judgmentApi.hallStats()).data });
  const monthly = useQueries({
    queries: civs.map((civilization) => ({
      queryKey: judgmentKeys.hallStats(civilization),
      queryFn: async () => (await judgmentApi.hallStats(civilization)).data,
    })),
  });
  const dispatches = useQuery({
    queryKey: ["dispatch", "zongbu"],
    queryFn: async () => (await dispatchApi.list({ ordering: "-proposed_at" })).data,
  });
  const crossings = useQuery({
    queryKey: ["cross-judgments", "zongbu"],
    queryFn: async () => (await crossTenantJudgmentsApi.list({ ordering: "-create_time" })).data,
  });

  const loaded = counts.every((c) => c.data);
  const sum = (pick: (c: { total: number; overdue?: number }) => number) => (loaded ? counts.reduce((n, c) => n + pick(c.data!), 0) : null);
  const pending = sum((c) => c.total);
  const overview = [
    ...(pending != null ? [{ text: t("zongbu.today", { n: String(pending) }), neg: false }] : []),
    ...overviewParts(t, null, sum((c) => c.overdue ?? 0), stats.data?.month_done_pct ?? null),
  ];
  const asOf = Math.max(0, ...counts.map((c) => c.dataUpdatedAt));
  const civName = (code: string | null | undefined) => {
    const short = civShortCode(code);
    return short ? t(`zongbu.civ.${short}`) : (code ?? "");
  };

  type CrossRow = { key: string; href: string; when: string | null; since?: boolean; text: string; statusNs: string; status: string };
  const isOpen = (status: string) => status === "PROPOSED" || status === "ACTIVE";
  const crossRows: CrossRow[] = [
    ...(dispatches.data?.results ?? []).slice(0, CROSS_ROWS).map((d) => ({
      key: `d-${d.id}`,
      href: `/dispatch/${d.id}`,
      when: d.update_time ?? d.proposed_at,
      text: [d.soul_name, t("zongbu.kind.dispatch"), `${civName(d.source_tenant_code)} → ${civName(d.target_tenant_code)}`].filter(Boolean).join(" · "),
      statusNs: "dispatch.states",
      status: d.status,
    })),
    ...(crossings.data?.results ?? []).slice(0, CROSS_ROWS).map((c) => ({
      key: `c-${c.id}`,
      href: `/cross-judgments/${c.id}`,
      // 未了结的没有结案时间,标开案那天(「某日起」)。
      when: isOpen(c.status) ? c.create_time : c.concluded_at,
      since: isOpen(c.status),
      text: [c.title, t("zongbu.kind.cross"), civName(c.initiating_tenant_code)].filter(Boolean).join(" · "),
      statusNs: "crossJudgments.states",
      status: c.status,
    })),
  ].sort((a, b) => (b.when ?? "").localeCompare(a.when ?? ""));

  return (
    <div className={s.zongbu} data-skin="neutral" data-testid="zongbu">
      <header className={s.zbHead}>
        <span className={s.watermark}>
          <BrandMark size={200} tone="gold" />
        </span>
        <p className={s.meta}>{[civs.length === 1 ? t(`zongbu.civ.${civShortCode(civs[0])}`) : t("zongbu.realms"), asOf ? t("zongbu.as_of", { time: formatDateTime(asOf, { hour: "2-digit", minute: "2-digit" }) }) : ""].filter(Boolean).join(" · ")}</p>
        <h1 className={`${s.zbTitle} font-title text-dossier`}>{t("zongbu.title")}</h1>
        <p className={s.overview} data-testid="zongbu-overview">
          {overview.map((p, i) => (
            <span key={p.text} className={p.neg ? s.neg : undefined}>
              {i ? ` · ${p.text}` : p.text}
            </span>
          ))}
        </p>
        <div className={s.actions}>
          <Link href="/judgment" className={buttonVariants({ variant: "primary", size: "md" })}>
            {t("zongbu.open_all")}
          </Link>
        </div>
      </header>

      <div className={s.cols} data-single={civs.length === 1 ? "" : undefined}>
        {civs.map((civ, i) => {
          const short = civShortCode(civ) ?? "";
          const c = counts[i].data;
          const month = monthly[i].data;
          const rows = (tops[i].data?.results ?? []).slice(0, TOP);
          return (
            <section key={civ} className={s.col} data-civ={short || undefined} data-testid={`zongbu-col-${short}`} aria-labelledby={`zongbu-${short}`}>
              <h2 id={`zongbu-${short}`} data-h2-role="column" className={s.colName}>
                {t(`zongbu.civ.${short}`)}
              </h2>
              {c ? (
                <>
                  {c.total > 0 ? <p className={s.colBig}>{c.total}</p> : null}
                  <p className={s.colLine}>
                    {c.total > 0 ? t("zongbu.col.pending") : t("zongbu.col.none_pending")}
                    {c.total > 0 ? (
                      (c.overdue ?? 0) > 0 ? (
                        <span className={s.neg}>{` · ${t("officer_app.desk.overview.overdue", { n: String(c.overdue) })}`}</span>
                      ) : (
                        ` · ${t("officer_app.desk.overview.no_overdue")}`
                      )
                    ) : null}
                  </p>
                </>
              ) : (
                <p className={s.colLine}>{counts[i].isError ? t("zongbu.col.failed") : t("common.loading")}</p>
              )}
              {month ? (
                month.month_done_pct != null ? (
                  <>
                    <p className={s.colLine}>{t("overview.month_done_pct", { pct: String(month.month_done_pct) })}</p>
                    <Meter
                      className={s.bar}
                      ratio={month.month_done_pct / 100}
                      role="progressbar"
                      aria-label={t("overview.month_done_pct", { pct: String(month.month_done_pct) })}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={month.month_done_pct}
                    />
                  </>
                ) : (
                  <p className={s.colLine}>{t("zongbu.col.month_none")}</p>
                )
              ) : null}
              {rows.length ? (
                <ul className={s.top}>
                  {rows.map((r) => (
                    <li key={r.id}>
                      <Link href={`/judgment/${r.id}`} className={s.topRow}>
                        <span className={s.topName}>{r.soul_name}</span>
                        <span className={r.is_overdue ? s.neg : s.caseNo}>{deadlineText(t, r)}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>

      <section className={s.cross} aria-labelledby="zongbu-cross">
        <h2 id="zongbu-cross" data-h2-role="column" className={s.juanTitle}>
          {t("zongbu.cross_title")}
        </h2>
        {crossRows.length ? (
          <div className={s.juan}>
            {crossRows.map((r) => (
              <Link key={r.key} href={r.href} className={s.crossRow}>
                <span className={s.juanKey}>
                  {r.since && r.when ? t("zongbu.cross_since", { date: formatListDate(r.when, locale) ?? "" }) : (formatListDate(r.when, locale) ?? "")}
                </span>
                <span className={s.juanVal}>{r.text}</span>
                <DomainEnum namespace={r.statusNs} value={r.status} className={s.juanKey} />
              </Link>
            ))}
          </div>
        ) : (
          <p className={s.juanKey}>{dispatches.isPending || crossings.isPending ? t("common.loading") : t("zongbu.cross_none")}</p>
        )}
      </section>

      <p className={s.zbFoot}>
        {t("zongbu.footer")}{" "}
        <Link href="/dashboard" className="underline">
          {t("zongbu.legacy")}
        </Link>
      </p>
    </div>
  );
}
