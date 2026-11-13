"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { useI18n } from "@/src/contexts/I18nContext";
import { PageShell } from "@/src/components/ui/PageShell";
import { sectionMark } from "@/src/lib/sectionMark";
import stats from "@/src/config/landing-stats.json";

/**
 * 系统状况(2026-11-14 用户决定;设计 be-obs §3.4,只做其中三块):每块右上角写明数据从哪来。
 *
 * ① 此刻 · 实测:本标签页的 Web Vitals,浏览器自带的 PerformanceObserver 量,不加 `web-vitals` 依赖。
 * ② 服务目标:`docs/SLO.md` 那张表的编号与目标 —— **目标,不是读数**。`AboutSystemPage.test.tsx` 逐行对照那份文档。
 * ③ 线上探测:`.github/workflows/demo-probe.yml` 每天一次。**页面不读它的结果**:徽章图要 `img-src` 放行 github.com,
 *    读运行记录要 `connect-src` 放行 api.github.com,用户定两样都不放(proxyAuthGate.test.ts 守着)。
 *    所以这里是一枚静态徽章(只说探测存在、多久一次)加一条到运行记录的链接;红绿只在 GitHub 上看。
 *
 * 演示与正式构建是同一页:都不连后端。回放层的请求计数(be-obs 实施清单第 12 项)还没有,不在这里假装有。
 */
const MUTED = "text-[oklch(var(--color-ink-muted))]";
const RULE = "border-[oklch(var(--color-rule))]";
const PROBE_RUNS = `${stats.github}/actions/workflows/demo-probe.yml`;

type VitalName = "LCP" | "INP" | "CLS";
/** Google 的两条线:≤ 第一个为好,≤ 第二个为待改进,再往上为差。 */
const THRESHOLDS: Record<VitalName, [number, number]> = { LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25] };
const VITALS: VitalName[] = ["LCP", "INP", "CLS"];

type Shift = PerformanceEntry & { value: number; hadRecentInput: boolean };
type Interaction = PerformanceEntry & { interactionId?: number };

/** 浏览器不支持这类条目(Safari 没有 LCP / layout-shift,jsdom 什么都没有)就什么也不做,读数停在「还没有」。 */
function observe(type: string, onEntries: (entries: PerformanceEntryList) => void, extra?: Record<string, number>): () => void {
  if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes?.includes(type)) return () => {};
  try {
    const o = new PerformanceObserver((list) => onEntries(list.getEntries()));
    o.observe({ type, buffered: true, ...extra } as PerformanceObserverInit);
    return () => o.disconnect();
  } catch {
    return () => {};
  }
}

function useVitals(): Record<VitalName, number | null> {
  const [v, setV] = useState<Record<VitalName, number | null>>({ LCP: null, INP: null, CLS: null });
  useEffect(() => {
    let cls = 0;
    const offs = [
      observe("largest-contentful-paint", (es) => {
        const last = es[es.length - 1];
        if (last) setV((p) => ({ ...p, LCP: last.startTime }));
      }),
      observe("layout-shift", (es) => {
        for (const e of es as Shift[]) if (!e.hadRecentInput) cls += e.value;
        setV((p) => ({ ...p, CLS: cls }));
      }),
      // ponytail: INP 取看到的最慢一次交互;真定义是约 50 次交互以上取 p98,一次访问到不了那个量。
      observe(
        "event",
        (es) => {
          const worst = Math.max(0, ...(es as Interaction[]).filter((e) => e.interactionId).map((e) => e.duration));
          if (worst > 0) setV((p) => ({ ...p, INP: Math.max(p.INP ?? 0, worst) }));
        },
        { durationThreshold: 16 },
      ),
    ];
    return () => offs.forEach((off) => off());
  }, []);
  return v;
}

function rating(name: VitalName, value: number): "good" | "needs_improvement" | "poor" {
  const [good, poor] = THRESHOLDS[name];
  return value <= good ? "good" : value <= poor ? "needs_improvement" : "poor";
}

/** 名称、目标与 `docs/SLO.md` 同行同值;旅程与「好事件」两列的字面量就是语言包键。 */
const SLO_ROWS: { id: string; journey: string; good: string; ms?: string; target: string }[] = [
  { id: "A1", journey: "about.system_journey_open_desk", good: "about.system_good_availability", target: "99.5%" },
  { id: "A2", journey: "about.system_journey_open_desk", good: "about.system_good_latency", ms: "400", target: "95%" },
  { id: "B1", journey: "about.system_journey_seal", good: "about.system_good_availability", target: "99.5%" },
  { id: "B2", journey: "about.system_journey_seal", good: "about.system_good_latency", ms: "800", target: "95%" },
  { id: "B3", journey: "about.system_journey_seal", good: "about.system_good_correctness", target: "100%" },
  { id: "C1", journey: "about.system_journey_timeline", good: "about.system_good_availability", target: "99.5%" },
  { id: "C2", journey: "about.system_journey_timeline", good: "about.system_good_latency", ms: "500", target: "95%" },
  { id: "C3", journey: "about.system_journey_timeline", good: "about.system_good_freshness", target: "99%" },
  { id: "D1", journey: "about.system_journey_realtime", good: "about.system_good_delivery", target: "99%" },
  { id: "E1", journey: "about.system_journey_tasks", good: "about.system_good_on_time", target: "99%" },
  { id: "E2", journey: "about.system_journey_webhook", good: "about.system_good_webhook", target: "99%" },
];

function Block({ id, stem, title, source, children }: { id: string; stem: string; title: string; source: string; children: ReactNode }) {
  const { locale } = useI18n();
  return (
    <section data-testid={`system-${id}`} aria-labelledby={`system-${id}-title`} className="pt-6">
      <div className={`flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2 ${RULE}`}>
        <h2 id={`system-${id}-title`} className="font-title text-lg text-[oklch(var(--color-ink))]">
          <span aria-hidden="true">{sectionMark(stem, locale)} · </span>
          {title}
        </h2>
        <span data-testid={`system-${id}-source`} className={`font-mono text-2xs ${MUTED}`}>
          {source}
        </span>
      </div>
      {children}
    </section>
  );
}

function Measured() {
  const { t } = useI18n();
  const vitals = useVitals();
  return (
    <>
      <dl className="grid grid-cols-3 gap-4 pt-3">
        {VITALS.map((name) => {
          const value = vitals[name];
          return (
            <div key={name} data-testid={`vital-${name}`}>
              <dt className={`font-mono text-2xs ${MUTED}`}>{name}</dt>
              <dd className="m-0 font-mono text-md tabular-nums text-[oklch(var(--color-ink))]">
                {value === null ? "—" : name === "CLS" ? value.toFixed(3) : `${Math.round(value)} ms`}
              </dd>
              <dd className={`m-0 text-xs ${MUTED}`}>
                {value === null
                  ? t("about.system_pending")
                  : { good: t("about.system_rating_good"), needs_improvement: t("about.system_rating_needs_improvement"), poor: t("about.system_rating_poor") }[rating(name, value)]}
              </dd>
            </div>
          );
        })}
      </dl>
      <p className={`pt-2 text-xs ${MUTED}`}>{t("about.system_measured_note")}</p>
    </>
  );
}

function Targets() {
  const { t } = useI18n();
  return (
    <>
      <table className="mt-2 w-full text-sm">
        <thead>
          <tr className={`border-b text-left text-2xs ${MUTED} ${RULE}`}>
            <th scope="col" className="py-1 pr-3 font-normal">{t("about.system_col_id")}</th>
            <th scope="col" className="py-1 pr-3 font-normal">{t("about.system_col_journey")}</th>
            <th scope="col" className="py-1 pr-3 font-normal">{t("about.system_col_good")}</th>
            <th scope="col" className="py-1 text-right font-normal">{t("about.system_col_target")}</th>
          </tr>
        </thead>
        <tbody>
          {SLO_ROWS.map((r) => (
            <tr key={r.id} data-testid="slo-row" className={`border-b ${RULE}`}>
              <td className="py-1 pr-3 font-mono text-xs">{r.id}</td>
              <td className="py-1 pr-3">{t(r.journey)}</td>
              <td className="py-1 pr-3">{t(r.good, r.ms ? { ms: r.ms } : undefined)}</td>
              <td className="py-1 text-right font-mono tabular-nums">{r.target}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`pt-2 text-xs ${MUTED}`}>{t("about.system_slo_note")}</p>
    </>
  );
}

function Probe() {
  const { t } = useI18n();
  return (
    <div className="pt-3 text-sm">
      {/* 静态徽章:只说探测存在、多久一次,不画红绿 —— 那要向 GitHub 取图或取数据,CSP 有意不放。 */}
      <span data-testid="probe-badge" className="inline-flex font-mono text-2xs">
        <span className="bg-[oklch(var(--color-ink))] px-2 py-0.5 text-[oklch(var(--color-canvas))]">{t("about.system_probe_badge")}</span>
        <span className={`border px-2 py-0.5 text-[oklch(var(--color-ink))] ${RULE}`}>{t("about.system_probe_badge_value")}</span>
      </span>
      <p className="pt-2">{t("about.system_probe_body")}</p>
      <p className="pt-1">
        <a href={PROBE_RUNS} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-[oklch(var(--color-ink))]">
          {t("about.system_probe_link")}
        </a>
      </p>
      <p className={`pt-2 text-xs ${MUTED}`}>{t("about.system_probe_why")}</p>
    </div>
  );
}

export default function AboutSystemPage() {
  const { t } = useI18n();
  return (
    <PageShell
      title={t("about.system_title")}
      subtitle={t("about.system_intro")}
      variant="prose"
      backLink={<Link href="/about" className="underline underline-offset-2">← {t("about.title")}</Link>}
    >
      <Block id="measured" stem="甲" title={t("about.system_measured")} source={t("about.system_measured_source")}>
        <Measured />
      </Block>
      <Block id="slo" stem="乙" title={t("about.system_slo")} source={t("about.system_slo_source")}>
        <Targets />
      </Block>
      <Block id="probe" stem="丙" title={t("about.system_probe")} source={t("about.system_probe_source")}>
        <Probe />
      </Block>
    </PageShell>
  );
}
