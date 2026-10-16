/**
 * 灵魂详情 (Design batch 39, O-15): a three-line header, then five tabs 身份 · 审判 · 功过 · 去向 · 事件 that stick
 * under the header on scroll, then the read-only footer. Everything here only reads.
 *
 * Tabs follow permission CODES (`soulTabs`); a tab is loaded the first time it is opened and stays mounted after,
 * so going back to it keeps its 「加载更多」 state. A tab that fails says so inside itself, with 重试; the header and
 * the other tabs are untouched. Only the soul itself failing is the whole-page `state.error_*`.
 */
import { dispositionApi, type Disposition } from "@soulledger/core/api/disposition";
import { eventsApi, type SoulEvent } from "@soulledger/core/api/events";
import { judgmentApi, type Judgment } from "@soulledger/core/api/judgment";
import { reincarnationApi, type Reincarnation } from "@soulledger/core/api/reincarnation";
import { sentencePlansApi } from "@soulledger/core/api/sentence-plans";
import { soulAccountsApi } from "@soulledger/core/api/soul-accounts";
import { soulsApi, type Soul } from "@soulledger/core/api/souls";
import { formatSoulCode } from "@soulledger/core/domain/soulCode";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { formatWhen } from "../format";
import { ActionButton, LoadingRows, RefreshFailed, Row, StateView, viewStateOf } from "../kit";
import { MoreRow, useMoreRows, type Page } from "../paged";
import { isDenied } from "../rules";
import { useSession } from "../session";
import { GUTTER, Notice, SectionLabel, Txt, space, useI18n, useRemote, useTheme } from "../shared";
import { SOUL_PAGE, deedScore, eventDetail, karmaView, planStops, signed, soulTabs, type SoulTab } from "../soulView";

const NO_PERMISSIONS: string[] = [];

function usePermissionCodes(): readonly string[] {
  const { state } = useSession();
  return state.status === "signedIn" ? (state.user.permissions ?? NO_PERMISSIONS) : NO_PERMISSIONS;
}

export function dateText(d: { year: number; month?: number | null; day?: number | null } | null | undefined): string {
  return d ? [d.year, d.month, d.day].filter((x) => x != null).join("-") : "—";
}

/**
 * A soul's name that opens this screen (待办详情、审判详情). Underlined with ›, at least 44 high; the code beside
 * it is never part of the link.
 */
export function SoulLink({ name, onOpen, variant = "bodyLg", testID }: { name: string; onOpen: () => void; variant?: "bodyLg" | "title" | "body"; testID?: string }) {
  const { t } = useI18n();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="link"
      accessibilityLabel={t("officer_app.soul.open_label", { name })}
      onPress={onOpen}
      style={{ minHeight: 44, justifyContent: "center", alignSelf: "flex-start" }}
    >
      <Txt variant={variant}>
        <Txt variant={variant} style={{ textDecorationLine: "underline" }}>
          {name}
        </Txt>
        {" ›"}
      </Txt>
    </Pressable>
  );
}

export function SoulDetail({ id, onOpenJudgment, footer }: { id: string; onOpenJudgment: (id: string) => void; footer: ReactNode }) {
  const { t } = useI18n();
  const theme = useTheme();
  const permissions = usePermissionCodes();
  const canCode = permissions.includes("soul_account.read");
  // The code is the current life's account (`soul_account.read`); `SoulSerializer` does not carry it. Without the
  // permission, or when the soul has no account, the header goes without it rather than failing.
  const load = useCallback(async (): Promise<{ soul: Soul; code: string | null }> => {
    const [soul, code] = await Promise.all([
      soulsApi.get(id).then((r) => r.data),
      canCode
        ? soulAccountsApi.accounts({ soul: id }).then(
            (r) => r.data.results.find((a) => a.retired_at === null)?.soul_code ?? null,
            () => null
          )
        : Promise.resolve(null),
    ]);
    return { soul, code };
  }, [id, canCode]);
  const { data, error, reload } = useRemote(load);
  const tabs = soulTabs(permissions);
  const [tab, setTab] = useState<SoulTab>("identity");
  const [opened, setOpened] = useState<SoulTab[]>(["identity"]);
  const view = viewStateOf({ data, error }, () => false, isDenied);
  if (view || !data) return <StateView state={view ?? "loading"} onRetry={reload} />;
  const { soul, code } = data;
  const pick = (next: SoulTab) => {
    setTab(next);
    setOpened((o) => (o.includes(next) ? o : [...o, next]));
  };
  return (
    <View testID="soul-detail" style={{ flex: 1 }}>
      <ScrollView stickyHeaderIndices={[1]} contentContainerStyle={{ paddingBottom: space[5] }}>
        <View>
          <RefreshFailed data={data} error={error} onRetry={reload} />
          <SoulHeader soul={soul} code={code} />
        </View>
        {/* The sticky wrapper is ScrollView's own (a column); the row lives one level down, or iOS stacks the tabs. */}
        <View style={{ backgroundColor: theme.s1 }}>
        <View testID="soul-tabs" accessibilityRole="tablist" style={{ minHeight: 44, flexDirection: "row", borderBottomWidth: 1, borderBottomColor: theme.hair, backgroundColor: theme.s1 }}>
          {tabs.map((k) => (
            <Pressable
              key={k}
              testID={`soul-tab-${k}`}
              accessibilityRole="tab"
              accessibilityState={{ selected: k === tab }}
              onPress={() => pick(k)}
              style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", borderBottomWidth: 2, borderBottomColor: k === tab ? theme.ink : "transparent" }}
            >
              <Txt variant="body" tone={k === tab ? "ink" : "muted"} style={k === tab ? { fontWeight: "600" } : undefined}>
                {t(`officer_app.soul.tabs.${k}`)}
              </Txt>
            </Pressable>
          ))}
        </View>
        </View>
        <View>
          {tabs
            .filter((k) => opened.includes(k))
            .map((k) => (
              <View key={k} testID={`soul-panel-${k}`} style={k === tab ? undefined : { display: "none" }}>
                {k === "identity" ? <IdentityTab soul={soul} /> : null}
                {k === "judgments" ? <JudgmentsTab soulId={id} onOpen={onOpenJudgment} /> : null}
                {k === "karma" ? <KarmaTab soulId={id} /> : null}
                {k === "fate" ? <FateTab soulId={id} dispositions={permissions.includes("disposition.read")} reincarnations={permissions.includes("reincarnation.read")} /> : null}
                {k === "events" ? <EventsTab soulId={id} /> : null}
              </View>
            ))}
        </View>
      </ScrollView>
      <View style={{ padding: space[4], gap: space[2], borderTopWidth: 1, borderTopColor: theme.hair, backgroundColor: theme.s1 }}>
        <Txt variant="caption" tone="muted">{t("officer_app.search.read_only")}</Txt>
        {footer}
      </View>
    </View>
  );
}

function Pill({ children, strong, testID }: { children: string; strong?: boolean; testID?: string }) {
  const theme = useTheme();
  return (
    <View testID={testID} style={{ minHeight: 26, paddingHorizontal: space[3], justifyContent: "center", borderWidth: 1, borderRadius: 13, borderColor: strong ? theme.ink : theme.inkSubtle }}>
      <Txt variant="caption" style={strong ? { fontWeight: "500" } : undefined}>{children}</Txt>
    </View>
  );
}

/** Monogram + name, code · civilization · life; the state pill (and 暂居); merit / demerit / balance; 已归档 dims it all. */
function SoulHeader({ soul, code }: { soul: Soul; code: string | null }) {
  const { t, enumLabel } = useI18n();
  const theme = useTheme();
  const archived = !!soul.is_archived;
  const tone = archived ? "muted" : "ink";
  const civ = enumLabel("souls.civilizations", soul.civilization);
  const meta = [code ? formatSoulCode(code) : null, civ.state === "known" ? civ.label : soul.civilization, t("souls.detail.generation", { n: String((soul.life_index ?? 0) + 1) })];
  const state = enumLabel("souls.states", soul.current_state);
  const figures: [string, number | undefined][] = [
    [t("souls.detail.merit"), soul.merit_score],
    [t("souls.detail.demerit"), soul.demerit_score == null ? undefined : -Math.abs(soul.demerit_score)],
    [t("souls.detail.balance"), soul.karmic_balance],
  ];
  return (
    <View style={{ backgroundColor: theme.s1 }}>
      <View testID="soul-header" style={{ padding: GUTTER, gap: space[4] }}>
        <View style={{ flexDirection: "row", gap: space[3], alignItems: "center" }}>
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ width: 52, height: 52, borderWidth: 1, borderColor: archived ? theme.inkSubtle : theme.ink, alignItems: "center", justifyContent: "center" }}
          >
            <Txt variant="title" tone={tone}>{Array.from(soul.name)[0] ?? ""}</Txt>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Txt variant="title" tone={tone} accessibilityRole="header">{soul.name}</Txt>
            <Txt variant="caption" tone="muted" testID="soul-meta">{meta.filter(Boolean).join(" · ")}</Txt>
          </View>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space[2] }}>
          {archived ? (
            <Pill testID="soul-archived-pill">{`□ ${t("records.archive.badge")}`}</Pill>
          ) : (
            <Pill strong testID="soul-state">{state.state === "known" ? state.label : soul.current_state}</Pill>
          )}
          {soul.is_residing ? (
            // Words and a glyph, never a colour.
            <Pill testID="soul-residing">{`▲ ${t("souls.detail.residing", { tenant: soul.home_tenant?.display_name ?? soul.home_civilization ?? "" })}`}</Pill>
          ) : null}
        </View>
        {soul.merit_score != null ? (
          // Absent for VIEWER (the serializer drops all three): then no cells at all.
          <View testID="soul-figures" style={{ flexDirection: "row", borderWidth: 1, borderColor: theme.hair }}>
            {figures.map(([label, n], i) => (
              <View key={label} style={{ flex: 1, paddingVertical: space[2], paddingHorizontal: space[3], borderLeftWidth: i ? 1 : 0, borderLeftColor: theme.hair }}>
                <Txt variant="caption" tone="muted">{label}</Txt>
                <Txt variant="value" style={{ fontSize: 17, lineHeight: 24 }}>{n == null ? "—" : signed(n)}</Txt>
              </View>
            ))}
          </View>
        ) : null}
      </View>
      {archived ? (
        <View accessibilityRole="text" style={{ paddingHorizontal: GUTTER, paddingVertical: space[3], borderTopWidth: 1, borderTopColor: theme.inkSubtle, backgroundColor: theme.s0 }}>
          <Txt variant="body" testID="soul-archive-banner">
            {[
              t("records.archive.banner", { date: formatWhen(soul.archived_at).slice(0, 10), name: soul.archived_by_name ?? "" }),
              soul.archive_reason ? t("officer_app.dispatch_status.reason", { reason: soul.archive_reason }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Txt>
        </View>
      ) : null}
    </View>
  );
}

function Fact({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <View style={{ width: wide ? "100%" : "47%", gap: space[1] }}>
      <Txt variant="caption" tone="muted">{label}</Txt>
      <Txt variant="body">{value}</Txt>
    </View>
  );
}

function IdentityTab({ soul }: { soul: Soul }) {
  const { t } = useI18n();
  return (
    <View testID="soul-identity" style={{ padding: GUTTER, flexDirection: "row", flexWrap: "wrap", gap: space[4] }}>
      <Fact label={t("souls.detail.birth")} value={[dateText(soul.birth_date), soul.origin_location].filter(Boolean).join(" · ")} />
      <Fact label={t("souls.detail.death")} value={dateText(soul.death_date)} />
      {soul.birth_name && soul.birth_name !== soul.name ? <Fact label={t("officer_app.soul.birth_name")} value={soul.birth_name} /> : null}
      {soul.description ? <Fact wide label={t("souls.detail.profile.description")} value={soul.description} /> : null}
    </View>
  );
}

/** Inside one tab only: 「这一块没能载入，其余照常显示」 + 重试. */
function TabFailed({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <View style={{ padding: GUTTER }}>
      <Notice tone="neg" onRetry={onRetry} testID="soul-tab-failed">
        {t("soul_app.errors.section")}
      </Notice>
    </View>
  );
}

function Empty({ children, testID }: { children: string; testID?: string }) {
  return (
    <View style={{ padding: GUTTER }}>
      <Txt variant="body" tone="muted" testID={testID}>{children}</Txt>
    </View>
  );
}

/** Full width 「加载更多」 and, under it, how many of how many are shown. No scroll-to-load: the end must be visible. */
function LoadMore({ more, shown, total, testID }: { more: (() => void) | null; shown: number; total: number; testID: string }) {
  const { t } = useI18n();
  if (total <= SOUL_PAGE) return null;
  return (
    <View style={{ padding: GUTTER, gap: space[2], alignItems: "center" }}>
      {more ? <ActionButton testID={`${testID}-more`} kind="outline" title={t("souls.detail.load_more")} onPress={more} style={{ alignSelf: "stretch" }} /> : null}
      <Txt variant="caption" tone="muted" testID={`${testID}-count`}>{t("officer_app.soul.shown_count", { shown: String(shown), total: String(total) })}</Txt>
    </View>
  );
}

const byLife = (a: Judgment, b: Judgment) => (b.cycle ?? 0) - (a.cycle ?? 0) || b.created_at.localeCompare(a.created_at);

function JudgmentsTab({ soulId, onOpen }: { soulId: string; onOpen: (id: string) => void }) {
  const { t, enumLabel } = useI18n();
  // The plan rides along: it lives at the bottom of this tab, and a plan this hall may not read (a third hall gets
  // 404) is just not shown, not a failure of the tab.
  const load = useCallback(async () => {
    const [page, plans] = await Promise.all([
      judgmentApi.list({ soul: soulId }).then((r) => r.data),
      sentencePlansApi.list({ soul: soulId }).then(
        (r) => r.data.results,
        () => []
      ),
    ]);
    return { page, plans };
  }, [soulId]);
  const { data, error, reload } = useRemote(load);
  const fetchPage = useCallback((page: number) => judgmentApi.list({ soul: soulId, page: String(page) }).then((r) => r.data), [soulId]);
  const { rows, more } = useMoreRows<Judgment>(data?.page ?? null, fetchPage);
  if (!data || !rows) return error ? <TabFailed onRetry={reload} /> : <LoadingRows />;
  const plan = [...data.plans].sort((a, b) => b.cycle - a.cycle)[0];
  const verdict = (j: Judgment) => {
    if (!j.verdict) return t("souls.detail.ledger.verdict_pending");
    const d = enumLabel("judgment.verdicts", j.verdict.toLowerCase());
    return d.state === "known" ? d.label : j.verdict;
  };
  return (
    <View>
      {rows.length === 0 ? <Empty testID="soul-judgments-empty">{t("judgment.no_judgments")}</Empty> : null}
      {[...rows].sort(byLife).map((j) => (
        <Row
          key={j.id}
          testID={`soul-judgment-${j.id}`}
          minHeight={64}
          title={[j.case_number, j.court].filter(Boolean).join(" · ")}
          lines={[t("officer_app.soul.judgment_meta", { n: String((j.cycle ?? 0) + 1), verdict: verdict(j), status: t(j.is_final ? "souls.detail.case_closed" : "souls.detail.case_open") })]}
          onPress={() => onOpen(j.id)}
          right={<Txt tone="muted">›</Txt>}
        />
      ))}
      <MoreRow more={more} />
      {plan ? <PlanStops plan={plan} /> : null}
    </View>
  );
}

function PlanStops({ plan }: { plan: Parameters<typeof planStops>[0] }) {
  const { t, enumLabel } = useI18n();
  const { nodes, current } = planStops(plan);
  return (
    <View testID="soul-plan" style={{ padding: GUTTER, gap: space[3] }}>
      <SectionLabel>{t("sentence_plan.panel_title")}</SectionLabel>
      {nodes.map((n) => {
        const realm = enumLabel("realms.names", n.realm_code);
        const status = enumLabel("sentence_plan.node_states", n.status);
        const term = n.is_eternal ? t("sentence_plan.eternal") : n.sentence_years != null ? t("sentence_plan.years", { years: String(n.sentence_years) }) : t("sentence_plan.years_unrecorded");
        return (
          <View key={n.id} testID={`soul-plan-node-${n.id}`} style={{ gap: space[1] }}>
            <Txt variant="bodyLg">{`${n.order}. ${realm.state === "known" ? realm.label : n.realm_code}`}</Txt>
            <Txt variant="caption" tone="muted">{[status.state === "known" ? status.label : n.status, term].join(" · ")}</Txt>
            {n.id === current ? <Txt variant="body" testID="soul-plan-current">{t("officer_app.soul.current_stop")}</Txt> : null}
          </View>
        );
      })}
    </View>
  );
}

function KarmaTab({ soulId }: { soulId: string }) {
  const { t, enumLabel } = useI18n();
  const theme = useTheme();
  const load = useCallback(() => soulsApi.records(soulId).then((r) => r.data), [soulId]);
  const { data, error, reload } = useRemote(load);
  // `/records/` is one unpaged array: the 20-a-time paging is on this side (`karmaView`).
  const [shown, setShown] = useState(SOUL_PAGE);
  if (!data) return error ? <TabFailed onRetry={reload} /> : <LoadingRows />;
  const view = karmaView(data, shown);
  if (view.total === 0) return <Empty testID="soul-karma-empty">{t("souls.detail.no_ledger")}</Empty>;
  return (
    <View testID="soul-karma">
      {view.groups.map((g) => (
        <View key={g.cycle}>
          <View style={{ paddingHorizontal: GUTTER, paddingTop: space[3], paddingBottom: space[1] }}>
            <Txt variant="caption" tone="muted" style={{ fontWeight: "600" }} testID={`soul-karma-group-${g.cycle}`}>
              {t("officer_app.soul.karma_group", { n: String(g.cycle + 1), count: String(g.count) })}
            </Txt>
          </View>
          {g.rows.map((r) => {
            const source = r.evidence_source ? enumLabel("souls.evidence_sources", r.evidence_source) : null;
            const when = r.event_date ? dateText(r.event_date) : formatWhen(r.recorded_at).slice(0, 10);
            return (
              <View key={r.id} testID={`soul-karma-row-${r.id}`} style={{ flexDirection: "row", gap: space[3], paddingHorizontal: GUTTER, paddingVertical: space[3], borderBottomWidth: 1, borderBottomColor: theme.hair }}>
                <View style={{ width: 56 }}>
                  <Txt variant="value" style={{ fontSize: 15 }}>{deedScore(r)}</Txt>
                  <Txt variant="caption" tone="muted">{t(r.record_type === "DEMERIT" ? "officer_app.soul.demerit_short" : "officer_app.soul.merit_short")}</Txt>
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Txt variant="body" numberOfLines={2}>{r.description}</Txt>
                  <Txt variant="caption" tone="muted">
                    {[when, source ? t("officer_app.soul.source", { source: source.state === "known" ? source.label : r.evidence_source! }) : null].filter(Boolean).join(" · ")}
                  </Txt>
                </View>
              </View>
            );
          })}
        </View>
      ))}
      <LoadMore testID="soul-karma" more={view.shown < view.total ? () => setShown((n) => n + SOUL_PAGE) : null} shown={view.shown} total={view.total} />
    </View>
  );
}

const EMPTY_PAGE = { results: [], next: null, count: 0 };

/** 去向 = 处置 + 轮回, each only when the session may read it. */
function FateTab({ soulId, dispositions, reincarnations }: { soulId: string; dispositions: boolean; reincarnations: boolean }) {
  const { t, enumLabel } = useI18n();
  const load = useCallback(async () => {
    const [d, r] = await Promise.all([
      dispositions ? dispositionApi.list({ soul: soulId }).then((x) => x.data) : Promise.resolve(EMPTY_PAGE),
      reincarnations ? reincarnationApi.list({ soul: soulId }).then((x) => x.data) : Promise.resolve(EMPTY_PAGE),
    ]);
    return { d: d as Page<Disposition>, r: r as Page<Reincarnation> };
  }, [soulId, dispositions, reincarnations]);
  const { data, error, reload } = useRemote(load);
  const dPage = useCallback((page: number) => dispositionApi.list({ soul: soulId, page: String(page) }).then((x) => x.data), [soulId]);
  const rPage = useCallback((page: number) => reincarnationApi.list({ soul: soulId, page: String(page) }).then((x) => x.data), [soulId]);
  const d = useMoreRows<Disposition>(data?.d ?? null, dPage);
  const r = useMoreRows<Reincarnation>(data?.r ?? null, rPage);
  if (!data || !d.rows || !r.rows) return error ? <TabFailed onRetry={reload} /> : <LoadingRows />;
  const label = (ns: string, raw: string | null | undefined) => {
    const x = enumLabel(ns, raw);
    return x.state === "known" ? x.label : (raw ?? "—");
  };
  return (
    <View>
      {dispositions ? (
        <View testID="soul-dispositions">
          <View style={{ paddingHorizontal: GUTTER, paddingTop: space[4] }}>
            <SectionLabel>{t("souls.detail.timeline.stage_disposed")}</SectionLabel>
          </View>
          {d.rows.length === 0 ? <Empty testID="soul-dispositions-empty">{t("officer_app.soul.no_disposition")}</Empty> : null}
          {d.rows.map((x) => (
            <Row
              key={x.id}
              testID={`soul-disposition-${x.id}`}
              minHeight={64}
              title={x.realm_name || label("realms.names", x.realm_code)}
              lines={[
                [
                  x.is_eternal ? t("disposition.term_eternal") : x.sentence_years != null ? t("sentence_plan.years", { years: String(x.sentence_years) }) : t("disposition.term_unrecorded"),
                  t(x.is_executed ? "disposition.executed" : "disposition.section_pending"),
                  formatWhen(x.executed_at ?? x.created_at),
                ].join(" · "),
              ]}
            />
          ))}
          <MoreRow more={d.more} />
        </View>
      ) : null}
      {reincarnations ? (
        <View testID="soul-reincarnations">
          <View style={{ paddingHorizontal: GUTTER, paddingTop: space[4] }}>
            <SectionLabel>{t("souls.detail.timeline.stage_reincarnating")}</SectionLabel>
          </View>
          {r.rows.length === 0 ? <Empty testID="soul-reincarnations-empty">{t("soul_app.common.empty")}</Empty> : null}
          {r.rows.map((x) => (
            <Row
              key={x.id}
              testID={`soul-reincarnation-${x.id}`}
              minHeight={64}
              title={x.new_identity}
              lines={[[t("souls.detail.generation", { n: String(x.cycle_count + 1) }), label("reincarnation.forms", x.rebirth_form), formatWhen(x.reincarnated_at)].join(" · ")]}
            />
          ))}
          <MoreRow more={r.more} />
        </View>
      ) : null}
    </View>
  );
}

/** Rows as on the desk's 灵魂事件 page, without the soul column: event · time · actor, and the detail when there is one. */
function EventsTab({ soulId }: { soulId: string }) {
  const { t, enumLabel } = useI18n();
  const load = useCallback(() => eventsApi.list({ soul: soulId }).then((r) => r.data), [soulId]);
  const { data, error, reload } = useRemote(load);
  // Paged by the server (20 a page); 「加载更多」 asks for the next one.
  const fetchPage = useCallback((page: number) => eventsApi.list({ soul: soulId, page: String(page) }).then((r) => r.data), [soulId]);
  const { rows, more } = useMoreRows<SoulEvent>(data, fetchPage);
  if (!data || !rows) return error ? <TabFailed onRetry={reload} /> : <LoadingRows />;
  if (rows.length === 0) return <Empty testID="soul-events-empty">{t("events.empty_all")}</Empty>;
  return (
    <View testID="soul-events">
      {rows.map((e) => {
        const type = enumLabel("souls.events", e.event_type);
        const actor = !e.actor || e.actor === "system" ? t("events.actor_system") : e.actor;
        const detail = eventDetail(e, enumLabel, t);
        return (
          <Row
            key={e.id}
            testID={`soul-event-${e.id}`}
            minHeight={64}
            title={type.state === "known" ? type.label : e.event_type}
            lines={[`${formatWhen(e.create_time)} · ${actor}`, ...(detail ? [detail] : [])]}
          />
        );
      })}
      <LoadMore testID="soul-events" more={more} shown={rows.length} total={data.count} />
    </View>
  );
}
