"use client";

import { useQuery } from "@tanstack/react-query";
import { judgmentApi, type Judgment, type JudgmentQueueCounts, type JudgmentQueueGroup } from "@soulledger/core/api/judgment";
import { soulsApi, type SoulRecordEntry } from "@soulledger/core/api/souls";
import { judgmentKeys, soulKeys } from "@soulledger/core/query_keys";
import { courtLabel } from "@soulledger/core/domain/courts";
import { formatHistoricalDate, formatListDate, type HistoricalDate } from "@soulledger/core/domain/dates";
import { useI18n } from "@/src/contexts/I18nContext";
import { usePermissions } from "@/src/hooks/usePermissions";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { PageHead } from "@/src/components/ui/PageShell";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { deadlineText, deskTag, sourceLabel } from "./deskRules";
import { DossierSpine } from "@/src/components/dossier/DossierSpine";
import { MeritMark, SignedNumber } from "@/src/components/dossier/MeritMark";
import { useSpineNow } from "@/src/components/dossier/useSpineNow";
import { dossierWhere } from "@/src/components/dossier/dossierWhere";
import s from "./desk.module.css";

type Action = { busy: boolean; run: () => void } | null;

/** Newest first: the event date when there is one (BCE years are negative), else when it was recorded. */
function recentRecords(records: readonly SoulRecordEntry[] | undefined, n = 3): SoulRecordEntry[] {
  const key = (r: SoulRecordEntry) => {
    const d = r.event_date;
    return d ? d.year * 10_000 + (d.month ?? 0) * 100 + (d.day ?? 0) : Number.NEGATIVE_INFINITY;
  };
  return [...(records ?? [])].sort((a, b) => key(b) - key(a) || b.recorded_at.localeCompare(a.recorded_at)).slice(0, n);
}

/**
 * 摊开的一份(Design 第三十批 第 2 步 · 右):顶线 + 卷宗头(人名 h1 宋体 32/40,上面一行 mono 12 的案号 · 殿 · 入册日期),
 * 三个按钮,脊(第 3 步之前是占位,只定位置与高度 `--spine-h`),卷(本世 · 来源 · 功过 · 供词 · 期限 · 经手 + 最近三条记录,
 * 只读),右栏两张小卡,底下键位提示。读的是已有的详情:`GET /judgment/{id}/` 与 `GET /souls/{id}/`(与卷宗页同一把缓存键)。
 */
export function OpenCase({
  row,
  group,
  position,
  counts,
  monthPct,
  onBack,
  onNext,
  onOpen,
  claim,
  release,
}: {
  row: Judgment;
  group: JudgmentQueueGroup;
  position: { n: number; total: number };
  counts: JudgmentQueueCounts | null;
  monthPct: number | null;
  onBack: () => void;
  onNext: () => void;
  onOpen: () => void;
  claim: Action;
  release: Action;
}) {
  const { t, locale } = useI18n();
  const day = (v: string | null | undefined) => formatListDate(v, locale, { time: false });
  const { hasPermission } = usePermissions();
  const detail = useQuery({ queryKey: judgmentKeys.detail(row.id), queryFn: async () => (await judgmentApi.get(row.id)).data });
  const soul = useQuery({
    queryKey: soulKeys.detail(row.soul),
    queryFn: async () => (await soulsApi.get(row.soul)).data,
    enabled: !!row.soul && hasPermission("soul.read"),
  });
  // The list row until the detail lands: the stack never shows a blank sheet while J is held down.
  const j: Judgment = detail.data ?? row;
  const tag = deskTag(t, j, group);
  const entered = day(j.created_at);
  const court = courtLabel(t, j.court, locale);
  const hist = (d: HistoricalDate | null | undefined) => (d ? (formatHistoricalDate(d, locale) ?? "") : "");

  const life = (() => {
    const so = soul.data;
    if (!so) return null;
    const born = so.birth_date
      ? so.origin_location
        ? t("caseDesk.juan.born_at", { date: hist(so.birth_date), place: so.origin_location })
        : t("caseDesk.juan.born", { date: hist(so.birth_date) })
      : "";
    const died = so.death_date ? t("caseDesk.juan.died", { date: hist(so.death_date) }) : "";
    return [born, died].filter(Boolean).join(" · ") || null;
  })();
  const soulUnread = soul.isError || !hasPermission("soul.read");
  const merit = j.merit_score;
  const demerit = j.demerit_score;
  const net = j.karmic_balance ?? (merit != null && demerit != null ? merit - demerit : null);
  const records = recentRecords(soul.data?.records);
  const spine = useSpineNow({
    soulId: soul.data ? row.soul : null,
    civilization: j.civilization,
    currentState: soul.data?.current_state,
    diyuStation: soul.data?.diyu_station,
    court: j.court,
  });
  /* 标签旁的「在哪」:站 · 界域 · 殿(第 3 步样张),与脊同一份数据。 */
  const where = dossierWhere(t, spine.now, { diyuStation: soul.data?.diyu_station, court: j.court, locale });
  const source = [sourceLabel(t, j), j.city_god_name].filter(Boolean).join(" · ");

  return (
    <>
      <div className={s.phoneBar}>
        <button type="button" onClick={onBack} data-testid="desk-back">
          {`‹ ${t("officer_app.desk.title")}`}
        </button>
        <span data-testid="desk-position">{t("officer_app.desk.position", { n: String(position.n), total: String(position.total) })}</span>
      </div>

      <PageHead
        kind="dossier"
        loading={detail.isPending}
        meta={[j.case_number, court, entered ? t("caseDesk.meta.entered", { date: entered }) : ""].filter(Boolean).join(" · ")}
        title={<span data-testid="desk-case-name">{j.soul_name}</span>}
        subtitle={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={tag.tone} glyph={tag.glyph || undefined}>
              {tag.text}
            </Badge>
            {where.length > 0 && <span data-testid="dossier-where">{where.join(" · ")}</span>}
          </span>
        }
        actions={
          <>
            {release ? (
              <Button variant="ghost" disabled={release.busy} onClick={release.run} data-testid="desk-release">
                {t("caseDesk.actions.release")}
              </Button>
            ) : null}
            {claim ? (
              <Button disabled={claim.busy} onClick={claim.run} data-testid="desk-claim" aria-keyshortcuts="C">
                {t("officer_app.queue.claim")}
                <span className={s.kbd} aria-hidden="true">
                  C
                </span>
              </Button>
            ) : null}
            <Button className={s.hideNarrow} onClick={onNext} disabled={position.n >= position.total} data-testid="desk-next" aria-keyshortcuts="J">
              {t("caseDesk.actions.next")}
              <span className={s.kbd} aria-hidden="true">
                J
              </span>
            </Button>
            <Button variant="primary" onClick={onOpen} data-testid="desk-open" aria-keyshortcuts="Enter">
              {t("caseDesk.actions.open")}
              <span className={s.kbd} aria-hidden="true">
                ↵
              </span>
            </Button>
          </>
        }
      />

      {/* 脊(第 3 步定稿):页头下方,高 `--spine-h`;「现在」是这个灵魂此刻所在那一站。与卷宗页同一个组件。 */}
      <DossierSpine civ={spine.civ} now={spine.now} testId="desk-spine" />

      <div className={s.body}>
        <div>
          <dl className={s.juan}>
            <JuanRow label={t("caseDesk.juan.life")}>
              {life ?? (soulUnread ? t("caseDesk.juan.unreadable") : soul.isPending ? t("common.loading") : <MissingValue kind="unrecorded" />)}
            </JuanRow>
            <JuanRow label={t("caseDesk.juan.source")}>{source}</JuanRow>
            <JuanRow label={t("caseDesk.juan.merits")}>
              {merit != null && demerit != null ? (
                <>
                  {/* 第 3 步第 4 条:两枚记号各带数,颜色只上净额。 */}
                  <MeritMark civilization={j.civilization} kind="merit" /> {merit}
                  {" · "}
                  <MeritMark civilization={j.civilization} kind="demerit" /> {demerit}
                  {net != null ? (
                    <>
                      {" · "}
                      {t("caseDesk.juan.net")} <SignedNumber value={net} />
                    </>
                  ) : null}
                </>
              ) : (
                <MissingValue kind="unrecorded" />
              )}
            </JuanRow>
            <JuanRow label={t("caseDesk.juan.confession")}>{j.confession?.trim() || t("caseDesk.juan.confession_none")}</JuanRow>
            <JuanRow label={t("caseDesk.juan.deadline")}>{deadlineText(t, j)}</JuanRow>
            <JuanRow label={t("caseDesk.juan.handler")}>
              {j.claimed_by_name
                ? j.claimed_at
                  ? t("caseDesk.juan.claimed", { name: j.claimed_by_name, date: day(j.claimed_at) ?? "" })
                  : j.claimed_by_name
                : t("caseDesk.juan.unclaimed")}
            </JuanRow>
          </dl>

          <h2 data-h2-role="column" className={s.juanTitle}>{t("caseDesk.juan.recent")}</h2>
          {records.length ? (
            <dl className={s.juan} data-testid="desk-recent">
              {records.map((r) => {
                const merit = r.record_type === "MERIT";
                return (
                  <JuanRow key={r.id} label={r.event_date ? hist(r.event_date) : (day(r.recorded_at) ?? "")} num={<SignedNumber value={r.weight} sign={merit ? 1 : -1} />}>
                    <MeritMark civilization={j.civilization} kind={merit ? "merit" : "demerit"} /> {r.description}
                  </JuanRow>
                );
              })}
            </dl>
          ) : (
            <p className={s.juanKey}>{soulUnread ? t("caseDesk.juan.unreadable") : soul.data ? t("caseDesk.juan.recent_none") : t("common.loading")}</p>
          )}
        </div>

        <aside className={s.side}>
          <h2 data-h2-role="column" className={s.juanTitle}>{t("caseDesk.side.this")}</h2>
          <dl className={s.card}>
            <dt>{t("caseDesk.juan.source")}</dt>
            <dd>{sourceLabel(t, j)}</dd>
            <dt>{t("caseDesk.side.court")}</dt>
            <dd>{court || <MissingValue kind="unrecorded" />}</dd>
            <dt>{t("caseDesk.side.claimed")}</dt>
            <dd>{j.claimed_by_name || t("caseDesk.juan.unclaimed")}</dd>
          </dl>
          <h2 data-h2-role="column" className={s.juanTitle}>{t("caseDesk.side.hall_today")}</h2>
          <dl className={s.card}>
            <dt>{t("officer_app.desk.groups.unclaimed")}</dt>
            <dd className={s.juanNum}>{counts ? counts.unclaimed : <MissingValue kind="unrecorded" />}</dd>
            <dt>{t("caseDesk.side.overdue")}</dt>
            <dd className={s.juanNum}>{counts?.overdue ?? <MissingValue kind="unrecorded" />}</dd>
            <dt>{t("caseDesk.side.done")}</dt>
            <dd className={s.juanNum}>{monthPct != null ? `${monthPct}%` : <MissingValue kind="unrecorded" />}</dd>
          </dl>
        </aside>
      </div>

      <p className={s.keys} aria-hidden="true">
        <span>
          <span className={s.kbd}>J</span> / <span className={s.kbd}>K</span> {t("caseDesk.keys.move")}
        </span>
        <span>
          <span className={s.kbd}>↵</span> {t("caseDesk.keys.open")}
        </span>
        <span>
          <span className={s.kbd}>C</span> {t("caseDesk.keys.claim")}
        </span>
        <span>
          <span className={s.kbd}>/</span> {t("caseDesk.keys.search")}
        </span>
      </p>
    </>
  );
}

function JuanRow({ label, children, num }: { label: string; children: React.ReactNode; num?: React.ReactNode }) {
  return (
    <div className={s.juanRow}>
      <dt className={s.juanKey}>{label}</dt>
      <dd className={s.juanVal}>{children}</dd>
      {num ? <dd className={s.juanNum}>{num}</dd> : <dd aria-hidden="true" />}
    </div>
  );
}
