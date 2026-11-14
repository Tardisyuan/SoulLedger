"use client";

import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { dossiersApi, type DeskRow } from "@soulledger/core/api/dossiers";
import type { JudgmentQueueGroup } from "@soulledger/core/api/judgment";
import { judgmentKeys } from "@soulledger/core/query_keys";
import { courtLabel } from "@soulledger/core/domain/courts";
import { formatHistoricalDate, formatListDate, type HistoricalDate } from "@soulledger/core/domain/dates";
import { useI18n } from "@/src/contexts/I18nContext";
import { Badge } from "@/src/components/ui/Badge";
import { Button } from "@/src/components/ui/Button";
import { PageHead } from "@/src/components/ui/PageShell";
import { MissingValue } from "@/src/components/ui/DomainValue";
import { deadlineText, deskTag, sourceLabel } from "./deskRules";
import { DossierSpine } from "@/src/components/dossier/DossierSpine";
import { MeritMark, SignedNumber } from "@/src/components/dossier/MeritMark";
import { spineCivOf, type SpineNow } from "@/src/components/dossier/spineModel";
import { dossierWhere } from "@/src/components/dossier/dossierWhere";
import s from "./desk.module.css";

type Action = { busy: boolean; run: () => void } | null;

/**
 * 摊开的一份(Design 第三十批 第 2 步 · 右):顶线 + 卷宗头(人名 h1 宋体 32/40,上面一行 mono 12 的案号 · 殿 · 入册日期),
 * 三个按钮,脊(第 3 步之前是占位,只定位置与高度 `--spine-h`),卷(本世 · 来源 · 功过 · 供词 · 期限 · 经手 + 最近三条记录,
 * 只读),右栏是判栏(`rail`,CaseDesk 懒加载的 `VerdictRail`;此前是「这一件」「同殿今天」两张小卡,信息已在摞的顶行与页头,
 * fe-ia §3.5 撤掉),底下键位提示。读一个请求:`GET /dossiers/{id}/` —— 案子、灵魂(连最近三条记录,服务端排好)、
 * 灵魂此刻在脊上的哪一点(`whereabouts.spine`,服务端算;此前前端从 `court` 的自由文本里抠殿号,再另取 `/souls/{id}/path/`)。
 * 看不到灵魂由服务端说(`soul_redacted`),不再由前端按权限猜。
 */
export function OpenCase({
  row,
  group,
  position,
  rail,
  onBack,
  onNext,
  onOpen,
  claim,
  release,
}: {
  row: DeskRow;
  group: JudgmentQueueGroup;
  position: { n: number; total: number };
  /** 判栏(桌面);393 宽 `.side` 不画,窄屏照旧「打开卷宗」。 */
  rail: ReactNode;
  onBack: () => void;
  onNext: () => void;
  onOpen: () => void;
  claim: Action;
  release: Action;
}) {
  const { t, locale } = useI18n();
  const day = (v: string | null | undefined) => formatListDate(v, locale, { time: false });
  const dossier = useQuery({ queryKey: judgmentKeys.dossier(row.id), queryFn: async () => (await dossiersApi.get(row.id)).data });
  const full = dossier.data?.judgment;
  const so = dossier.data?.soul ?? null;
  // The list row until the dossier lands: the stack never shows a blank sheet while J is held down.
  const j = full ?? row;
  const tag = deskTag(t, j, group);
  const entered = day(full?.created_at);
  const court = courtLabel(t, j.court, locale);
  const hist = (d: HistoricalDate | null | undefined) => (d ? (formatHistoricalDate(d, locale) ?? "") : "");

  const life = (() => {
    if (!so) return null;
    const born = so.birth_date
      ? so.origin_location
        ? t("caseDesk.juan.born_at", { date: hist(so.birth_date), place: so.origin_location })
        : t("caseDesk.juan.born", { date: hist(so.birth_date) })
      : "";
    const died = so.death_date ? t("caseDesk.juan.died", { date: hist(so.death_date) }) : "";
    return [born, died].filter(Boolean).join(" · ") || null;
  })();
  const soulUnread = dossier.isError || !!dossier.data?.soul_redacted;
  const merit = full?.merit_score;
  const demerit = full?.demerit_score;
  const net = full?.karmic_balance ?? (merit != null && demerit != null ? merit - demerit : null);
  const records = so?.records ?? [];
  const spine = { civ: spineCivOf(j.civilization), now: (dossier.data?.whereabouts?.spine ?? null) as SpineNow | null };
  /* 标签旁的「在哪」:站 · 界域 · 殿(第 3 步样张),与脊同一份数据。 */
  const where = dossierWhere(t, spine.now, { diyuStation: so?.diyu_station, court: j.court, locale });
  const source = [sourceLabel(t, j), full?.city_god_name].filter(Boolean).join(" · ");

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
        loading={dossier.isPending}
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
              {life ?? (soulUnread ? t("caseDesk.juan.unreadable") : dossier.isPending ? t("common.loading") : <MissingValue kind="unrecorded" />)}
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
            <JuanRow label={t("caseDesk.juan.confession")}>{full?.confession?.trim() || t("caseDesk.juan.confession_none")}</JuanRow>
            <JuanRow label={t("caseDesk.juan.deadline")}>{deadlineText(t, j)}</JuanRow>
            <JuanRow label={t("caseDesk.juan.handler")}>
              {j.claimed_by_name
                ? full?.claimed_at
                  ? t("caseDesk.juan.claimed", { name: j.claimed_by_name, date: day(full.claimed_at) ?? "" })
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
                  <JuanRow key={r.id} label={r.event_date ? hist(r.event_date) : (day(r.recorded_at) ?? "")} num={<SignedNumber value={r.weight ?? 0} sign={merit ? 1 : -1} />}>
                    <MeritMark civilization={j.civilization} kind={merit ? "merit" : "demerit"} /> {r.description}
                  </JuanRow>
                );
              })}
            </dl>
          ) : (
            <p className={s.juanKey}>{soulUnread ? t("caseDesk.juan.unreadable") : so ? t("caseDesk.juan.recent_none") : t("common.loading")}</p>
          )}
        </div>

        <aside className={s.side} aria-label={t("caseDesk.verdict.rail")}>
          {rail}
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
          <span className={s.kbd}>1–4</span> · <span className={s.kbd}>⌘⏎</span> {t("caseDesk.dossier.judge.seal")}
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
