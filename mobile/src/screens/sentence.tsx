/**
 * 「我的受刑」(受刑 handoff, app-civ/sentence): the life page's section (1b),
 * the full-screen station list (1c), and the rebirth page's refusal block (1d).
 *
 * The server has already merged the nine node states into what a soul sees
 * (`/me/sentence-plan/`, 1a): a removed station never arrives, a dispatch in
 * progress arrives as "not started". Nothing here re-derives that.
 *
 * A push lands here (1d) with the same highlight as an application's result:
 * a 3px rule and a 「新」 tag, gone once the page is left — no read timestamps.
 */
import {
  soulApi,
  soulErrorMessage,
  type MeSentencePlan,
  type MeSentenceStation,
  type SentenceStationStatus,
} from "@soulledger/core/api/soul";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useEffect, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Svg, { Line } from "react-native-svg";

import { Emblem, Node } from "../emblems";
import { useI18n } from "../i18n";
import { civKeyOf } from "../theme";
import {
  Button,
  Empty,
  GUTTER,
  Screen,
  ScreenError,
  Skeleton,
  SmallButton,
  Txt,
  enumText,
  useLayout,
  useReloadOnRefocus,
  useRemote,
  useTheme,
} from "../ui";
import { useResidenceNames, type AppStackParams } from "./applications";
import { realmName } from "./life";

/** The four push kinds that land on the sentence plan (1d). */
export const SENTENCE_PUSH_KINDS = ["sentence_completed", "sentence_waiting", "sentence_amended", "sentence_pardoned"] as const;
export type SentencePushKind = (typeof SENTENCE_PUSH_KINDS)[number];
/** Where a sentence push landed: its kind, and the stations the server named as new (amended / waiting). */
export type SentenceLanding = { kind: SentencePushKind; nodeIds: string[] };

const STATUS_KEY: Record<SentenceStationStatus, string> = {
  pending: "soul_app.sentence.state.pending",
  active: "soul_app.sentence.state.active",
  waiting: "soul_app.sentence.state.waiting",
  done: "soul_app.sentence.state.done",
  eternal: "soul_app.sentence.state.eternal",
  pardoned: "soul_app.sentence.state.pardoned",
};

/** The soul is at this station (serving, held, or there for good). */
const OCCUPYING: SentenceStationStatus[] = ["active", "waiting", "eternal"];

/** The station the section details: where the soul is; else the next to start; else the last. */
export function currentStation(plan: MeSentencePlan): MeSentenceStation | null {
  const s = plan.stations;
  return s.find((x) => OCCUPYING.includes(x.status)) ?? (plan.state === "between" ? s.find((x) => x.status === "pending") : undefined) ?? s[s.length - 1] ?? null;
}

/** Which stations a landing marks 「新」 (1d's table): the named ones, the struck ones on a pardon, the last on completion. */
export function isNew(landing: SentenceLanding | undefined, station: MeSentenceStation, plan: MeSentencePlan): boolean {
  if (!landing) return false;
  if (landing.nodeIds.includes(station.id)) return true;
  if (landing.kind === "sentence_pardoned") return station.status === "pardoned";
  if (landing.kind === "sentence_waiting") return landing.nodeIds.length === 0 && station.status === "waiting";
  return landing.kind === "sentence_completed" && station === plan.stations[plan.stations.length - 1];
}

function NewTag({ testID }: { testID?: string }) {
  const theme = useTheme();
  const { t } = useI18n();
  return (
    <View testID={testID} style={[styles.newTag, { borderColor: theme.accent }]}>
      <Txt variant="label" tone="accent" style={styles.newTagText}>
        {t("soul_app.sentence.amended_tag")}
      </Txt>
    </View>
  );
}

/** A station's node (1g): its own civilization's shape; mark when recorded, hair2 when not reached. */
function StationNode({ station, size = 13 }: { station: MeSentenceStation; size?: number }) {
  const theme = useTheme();
  const reached = station.status !== "pending" && station.status !== "pardoned";
  const civ = civKeyOf(station.civilization);
  return (
    <Node
      testID={`station-node-${station.n}-${civ}`}
      civ={civ}
      size={size}
      stroke={reached ? theme.mark : theme.hair2}
      filled={station.status === "done" || station.status === "eternal"}
      current={OCCUPYING.includes(station.status)}
    />
  );
}

/** Solid = recorded, dashed = not yet / never (1g). */
function Link({ recorded, vertical, testID }: { recorded: boolean; vertical?: boolean; testID?: string }) {
  const theme = useTheme();
  const common = { stroke: recorded ? theme.mark : theme.hair2, strokeWidth: 1.2, strokeDasharray: recorded ? undefined : "3 3" };
  return (
    <View testID={testID} style={vertical ? styles.linkV : styles.linkH}>
      <Svg width={vertical ? 2 : "100%"} height={vertical ? "100%" : 2}>
        {vertical ? <Line x1={1} y1={0} x2={1} y2="100%" {...common} /> : <Line x1={0} y1={1} x2="100%" y2={1} {...common} />}
      </Svg>
    </View>
  );
}

const recordedTo = (next: MeSentenceStation) => next.status !== "pending" && next.status !== "pardoned";

function termText(station: MeSentenceStation, t: (key: string, params?: Record<string, string>) => string): string {
  if (station.is_eternal) return t("soul_app.sentence.term_eternal");
  if (station.sentence_years !== null) return t("soul_app.sentence.term_years", { years: String(station.sentence_years) });
  return t("common.value.unrecorded");
}

const UNDERWORLDS = ["CHINESE", "EUROPEAN", "EGYPTIAN", "GREEK"];

/** A station's place by its underworld's name (中国地府 / 杜阿特 …, the welcome's words); an unknown code by the enum. */
function useUnderworld(): (civilization: string) => string {
  const { t, enumLabel } = useI18n();
  return (c) => (UNDERWORLDS.includes(c) ? t(`soul_app.welcome.realm.${c}`) : enumText(enumLabel("souls.civilizations", c), t));
}

/** 「中国地府 · 原属」/「杜阿特 · 暂居」: the station's civilization, and whether the soul is (or was) away there. */
function CivLine({ station }: { station: MeSentenceStation }) {
  const theme = useTheme();
  const { t } = useI18n();
  const underworld = useUnderworld();
  const civ = civKeyOf(station.civilization);
  const away = !station.is_home;
  const suffix = station.is_home ? t("soul_app.sentence.home_civ") : OCCUPYING.includes(station.status) ? t("soul_app.sentence.away_civ") : null;
  const name = underworld(station.civilization);
  return (
    <View style={styles.civLine}>
      <Emblem civ={civ} size={12} stroke={away ? theme.accent : theme.mark} />
      <Txt variant="label" tone={away ? "accent" : "mark"} style={styles.shrink}>
        {suffix ? `${name} · ${suffix}` : name}
      </Txt>
    </View>
  );
}

function Span({ station }: { station: MeSentenceStation }) {
  const { t } = useI18n();
  if (!station.started_on) return null;
  return (
    <Row label={t("soul_app.sentence.span")}>
      <Txt variant="value" tone="muted">{`${station.started_on} — ${station.ends_on ?? ""}`}</Txt>
    </Row>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.row}>
      <Txt variant="caption" tone="subtle" style={styles.rowLabel}>
        {label}
      </Txt>
      <View style={styles.shrink}>{children}</View>
    </View>
  );
}

function StationDetail({ station, fresh, landing }: { station: MeSentenceStation; fresh: boolean; landing?: SentenceLanding }) {
  const { t, locale } = useI18n();
  const struck = station.status === "pardoned";
  // An amendment names only the stations it added (a reduction names none), so the note says "added".
  const added = landing?.kind === "sentence_amended" && landing.nodeIds.includes(station.id);
  return (
    <View testID={`station-${station.n}`} style={struck ? styles.struck : undefined}>
      <View style={styles.stationHead}>
        <Txt variant="value" tone="subtle">
          {t("soul_app.sentence.station", { n: String(station.n) })}
        </Txt>
        <Txt variant="bodyLg" style={[styles.shrink, struck && styles.strike]}>
          {station.realm ? realmName(station.realm, locale) : t("common.value.unrecorded")}
        </Txt>
        {fresh ? <NewTag testID={`station-${station.n}-new`} /> : null}
      </View>
      {added ? (
        <Txt testID={`station-${station.n}-added`} variant="caption" tone="muted">
          {t("soul_app.sentence.amended_note")}
        </Txt>
      ) : null}
      <CivLine station={station} />
      <View style={styles.rows}>
        <Row label={t("soul_app.sentence.term")}>
          <Txt variant="value" tone="muted">
            {termText(station, t)}
          </Txt>
        </Row>
        <Span station={station} />
      </View>
    </View>
  );
}

/** `withEnd`: where the soul is, the state line also says until when (1c 「受刑中 · 至 …」). */
function StatusText({ station, withEnd }: { station: MeSentenceStation; withEnd?: boolean }) {
  const { t } = useI18n();
  const here = OCCUPYING.includes(station.status);
  const tone = station.status === "pending" ? "subtle" : station.status === "pardoned" ? "muted" : here ? "accent" : "mark";
  const state = t(STATUS_KEY[station.status]);
  return (
    <Txt testID={`station-${station.n}-status`} variant="caption" tone={tone}>
      {withEnd && here && station.ends_on ? `${state} · ${t("soul_app.sentence.until", { date: station.ends_on })}` : state}
    </Txt>
  );
}

/** Points = stations (1b 一). Not a percentage: a term is counted in years. */
function Axis({ plan }: { plan: MeSentencePlan }) {
  return (
    <View testID="sentence-axis" style={styles.axis}>
      {plan.stations.map((s, i) => (
        <View key={s.id} style={i ? styles.axisStep : undefined}>
          {i ? <Link recorded={recordedTo(s)} testID={`axis-link-${s.n}`} /> : null}
          <StationNode station={s} />
        </View>
      ))}
    </View>
  );
}

/** The 3px mark rule down the section's left — "the block to read on this page" — and, on a landing, the tag. */
function Ruled({
  landed,
  children,
  testID,
  onLayout,
}: {
  landed: boolean;
  children: ReactNode;
  testID?: string;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const theme = useTheme();
  const { gutter } = useLayout();
  return (
    <View testID={testID} onLayout={onLayout} style={[styles.ruled, { paddingHorizontal: gutter, borderBottomColor: theme.hair }, landed && { backgroundColor: theme.s1 }]}>
      <View testID={landed ? "sentence-landing-rule" : undefined} pointerEvents="none" style={[styles.rule, { backgroundColor: theme.mark }]} />
      {children}
    </View>
  );
}

function ApplyRow({ plan }: { plan: MeSentencePlan }) {
  const { t } = useI18n();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  if (!plan.rebirth_open || (plan.state !== "completed" && plan.state !== "pardoned")) return null;
  return <Button testID="sentence-apply" title={t("soul_app.sentence.go_apply")} onPress={() => navigation.navigate("Tabs", { screen: "Applications" })} />;
}

/**
 * 1b: on the life page, between judgments and dispositions. One axis, the
 * current station in full; the rest behind 「全部」.
 */
export type SentenceRemote = ReturnType<typeof useSentencePlan>;

/**
 * The life page's request for the plan. Owned by the page, not the section: the
 * section only mounts once the life record has loaded, and a request started
 * that late outlives the page's own (the same moment the past lives start).
 */
export function useSentencePlan({ landing, reloadKey }: { landing?: SentenceLanding; reloadKey: number }) {
  const remote = useRemote(soulApi.sentencePlan);
  const { reload } = remote;
  useReloadOnRefocus(reload);
  // A pull on the life page, or a push landing while the page is already open: the plan just changed.
  useEffect(() => {
    if (reloadKey || landing) void reload();
  }, [reloadKey, landing, reload]);
  return remote;
}

export function SentenceSection({
  remote,
  landing,
  onPlaced,
}: {
  remote: SentenceRemote;
  landing?: SentenceLanding;
  /** The section's top within its parent — the life page scrolls a landing to it. */
  onPlaced?: (y: number) => void;
}) {
  const { t } = useI18n();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const plan = remote.data;
  const current = plan ? currentStation(plan) : null;
  const hasPlan = !!plan && plan.state !== "none";
  const final = plan?.state === "eternal";
  return (
    <Ruled landed={!!landing} testID="section-sentence" onLayout={onPlaced && ((e) => onPlaced(e.nativeEvent.layout.y))}>
      <View style={styles.head}>
        <Txt variant="section">{t("soul_app.sentence.section_title")}</Txt>
        {hasPlan && current && !final ? (
          <Txt testID="sentence-progress" variant="value" tone="subtle">
            {t("soul_app.sentence.progress", { cur: String(current.n), total: String(plan.stations.length) })}
          </Txt>
        ) : null}
        <View style={styles.fill} />
        {landing ? <NewTag testID="sentence-landing-tag" /> : null}
        {hasPlan ? (
          <Pressable testID="sentence-all" accessibilityRole="button" hitSlop={8} onPress={() => navigation.navigate("Sentence", { landing })}>
            <Txt variant="caption" tone="accent">{`${t("soul_app.sentence.all")} →`}</Txt>
          </Pressable>
        ) : null}
      </View>
      {plan ? (
        !hasPlan ? (
          <Empty testID="sentence-empty" text={t("soul_app.sentence.empty")} />
        ) : (
          <View style={styles.sectionBody}>
            {final ? null : <Axis plan={plan} />}
            {current ? (
              <>
                <StationDetail station={current} fresh={isNew(landing, current, plan)} landing={landing} />
                <StatusText station={current} />
              </>
            ) : null}
            {plan.state === "completed" && plan.rebirth_open ? <Txt variant="bodyLg">{t("soul_app.sentence.all_done_title")}</Txt> : null}
            <ApplyRow plan={plan} />
          </View>
        )
      ) : remote.error ? (
        <View testID="sentence-error" style={styles.errorRow}>
          <Txt variant="caption" tone="muted" style={styles.fill}>
            {t("soul_app.sentence.error")}
          </Txt>
          <SmallButton testID="sentence-retry" title={t("soul_app.common.retry")} onPress={() => void remote.reload()} />
        </View>
      ) : (
        <View testID="sentence-loading" style={styles.sectionBody}>
          <Skeleton lines={2} />
          <Txt variant="caption" tone="subtle">
            {t("soul_app.sentence.loading")}
          </Txt>
        </View>
      )}
    </Ruled>
  );
}

/** The banner under the title bar (1c): the state's title and body, and the way on when there is one. */
function Banner({ plan }: { plan: MeSentencePlan }) {
  const theme = useTheme();
  const { t } = useI18n();
  const copy: Partial<Record<MeSentencePlan["state"], { title: string; body: string[]; tone: string }>> = {
    between: { title: "soul_app.sentence.next_not_started", body: ["soul_app.sentence.next_not_started_body"], tone: theme.hair2 },
    waiting: { title: "soul_app.sentence.state.waiting", body: ["soul_app.sentence.waiting_why"], tone: theme.accent },
    eternal: { title: "soul_app.sentence.eternal_title", body: ["soul_app.sentence.eternal_body", "soul_app.sentence.eternal_no_rebirth"], tone: theme.hair2 },
    pardoned: { title: "soul_app.sentence.pardoned_title", body: ["soul_app.sentence.pardoned_body"], tone: theme.pos },
    completed: {
      title: "soul_app.sentence.all_done_title",
      // The body says "you may apply now": only where there is a rebirth to apply for.
      body: plan.rebirth_open ? ["soul_app.sentence.all_done_body"] : [],
      tone: theme.pos,
    },
  };
  const c = copy[plan.state];
  if (!c) return null;
  return (
    <View testID={`sentence-banner-${plan.state}`} style={[styles.banner, { borderBottomColor: theme.hair, borderLeftColor: c.tone, backgroundColor: theme.s1 }]}>
      <Txt variant="bodyLg">{t(c.title)}</Txt>
      {c.body.map((k) => (
        <Txt key={k} variant="caption" tone="muted">
          {t(k, { total: String(plan.stations.length) })}
        </Txt>
      ))}
      <ApplyRow plan={plan} />
    </View>
  );
}

function StationRow({ station, next, plan, landing }: { station: MeSentenceStation; next?: MeSentenceStation; plan: MeSentencePlan; landing?: SentenceLanding }) {
  const theme = useTheme();
  const { t } = useI18n();
  const here = OCCUPYING.includes(station.status);
  return (
    <View style={styles.stationRow}>
      <View style={styles.rail}>
        <View style={styles.nodeNudge}>
          <StationNode station={station} />
        </View>
        {next ? <Link vertical recorded={recordedTo(next)} testID={`list-link-${next.n}`} /> : null}
      </View>
      <View style={[styles.fill, next && styles.stationGap]}>
        <View style={[here && [styles.here, { borderColor: theme.mark, backgroundColor: theme.s1 }]]}>
          <StationDetail station={station} fresh={isNew(landing, station, plan)} landing={landing} />
          <View style={styles.rows}>
            <Row label={t("soul_app.sentence.field_state")}>
              <StatusText station={station} withEnd />
            </Row>
          </View>
          {station.status === "waiting" ? (
            <Txt testID={`station-${station.n}-why`} variant="caption" tone="muted" style={[styles.why, { borderLeftColor: theme.accent }]}>
              {t("soul_app.sentence.waiting_why")}
            </Txt>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** 1c: the whole plan, one row per station, in the six states' words. */
export function SentenceScreen({ landing }: { landing?: SentenceLanding }) {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  const remote = useRemote(soulApi.sentencePlan);
  const residence = useResidenceNames();
  const plan = remote.data;
  if (remote.error && !plan) {
    return (
      <Screen scroll={false}>
        <ScreenError error={soulErrorMessage(remote.error)} onRetry={remote.reload} />
      </Screen>
    );
  }
  if (!plan) {
    return (
      <Screen>
        <View style={{ padding: gutter }}>
          <Skeleton lines={5} testID="sentence-screen-loading" />
        </View>
      </Screen>
    );
  }
  const current = currentStation(plan);
  return (
    <Screen refreshing={remote.loading} onRefresh={remote.reload} testID={`sentence-screen-${plan.state}`}>
      {plan.state === "none" ? (
        <Empty testID="sentence-empty" text={t("soul_app.sentence.empty")} />
      ) : (
        <>
          {residence ? (
            <View testID="sentence-residing" style={[styles.banner, { borderBottomColor: theme.hair, borderLeftColor: theme.accent, backgroundColor: theme.s1 }]}>
              <Txt variant="bodyLg">{t("soul_app.life.residing", residence)}</Txt>
              <Txt variant="caption" tone="muted">
                {t("soul_app.sentence.residing_body", residence)}
              </Txt>
            </View>
          ) : null}
          <Banner plan={plan} />
          <View style={[styles.summary, { paddingHorizontal: gutter, borderBottomColor: theme.hair }]}>
            <Txt testID="sentence-total" variant="label" tone="subtle">
              {t("soul_app.sentence.total_stations", { total: String(plan.stations.length) })}
            </Txt>
            <View style={styles.fill} />
            {plan.state !== "eternal" && current ? (
              <>
                <Txt variant="value" tone="muted">
                  {t("soul_app.sentence.progress", { cur: String(current.n), total: String(plan.stations.length) })}
                </Txt>
                <Txt variant="caption" tone="subtle">
                  {t(STATUS_KEY[current.status])}
                </Txt>
              </>
            ) : null}
          </View>
          <View style={{ padding: gutter }}>
            {plan.stations.map((s, i) => (
              <StationRow key={s.id} station={s} next={plan.stations[i + 1]} plan={plan} landing={landing} />
            ))}
          </View>
        </>
      )}
    </Screen>
  );
}

/**
 * 1d: the rebirth page when the server answers `sentence_in_progress`. Not the
 * plan again — only how many stations, where the soul is now, and until when.
 */
export function SentenceBlocked() {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const underworld = useUnderworld();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const remote = useRemote(soulApi.sentencePlan);
  const plan = remote.data;
  const current = plan ? currentStation(plan) : null;
  return (
    <View testID="sentence-blocked" style={[styles.blocked, { borderColor: theme.hair, borderLeftColor: theme.accent, backgroundColor: theme.s1 }]}>
      <Txt variant="bodyLg">{t("soul_app.sentence.blocked_title")}</Txt>
      <Txt variant="caption" tone="muted">
        {plan && plan.stations.length
          ? t("soul_app.sentence.blocked_body", { total: String(plan.stations.length) })
          : t("soul_app.errors.sentence_in_progress")}
      </Txt>
      {plan && current ? (
        <View style={[styles.blockedStation, { borderTopColor: theme.hair }]}>
          <View style={styles.stationHead}>
            <Txt variant="value" tone="subtle">
              {t("soul_app.sentence.progress", { cur: String(current.n), total: String(plan.stations.length) })}
            </Txt>
            <StatusText station={current} />
          </View>
          <Txt variant="body">
            {`${current.realm ? realmName(current.realm, locale) : t("common.value.unrecorded")} · ${underworld(current.civilization)}`}
          </Txt>
          {current.ends_on ? (
            <Txt testID="sentence-blocked-until" variant="value" tone="subtle">
              {t("soul_app.sentence.until", { date: current.ends_on })}
            </Txt>
          ) : null}
        </View>
      ) : null}
      <Pressable testID="sentence-blocked-link" accessibilityRole="link" hitSlop={8} onPress={() => navigation.navigate("Sentence", {})}>
        <Txt variant="caption" tone="accent">{`${t("soul_app.sentence.blocked_link")} →`}</Txt>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  ruled: { borderBottomWidth: 1, paddingVertical: 16, gap: 12 },
  rule: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  head: { flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" },
  sectionBody: { gap: 10 },
  newTag: { borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  newTagText: { fontSize: 10, lineHeight: 14 },
  axis: { flexDirection: "row", alignItems: "center", paddingVertical: 6 },
  axisStep: { flex: 1, flexDirection: "row", alignItems: "center" },
  linkH: { flex: 1, height: 2, marginHorizontal: 6 },
  linkV: { flex: 1, width: 2, marginVertical: 5 },
  civLine: { flexDirection: "row", alignItems: "center", gap: 7, marginTop: 6 },
  stationHead: { flexDirection: "row", alignItems: "baseline", gap: 9, flexWrap: "wrap" },
  rows: { marginTop: 8, gap: 4 },
  row: { flexDirection: "row", gap: 14 },
  rowLabel: { minWidth: 36 },
  struck: { opacity: 0.62 },
  strike: { textDecorationLine: "line-through" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  banner: { paddingHorizontal: GUTTER, paddingVertical: 16, borderBottomWidth: 1, borderLeftWidth: 3, gap: 7 },
  summary: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, borderBottomWidth: 1 },
  stationRow: { flexDirection: "row", gap: 14 },
  rail: { width: 13, alignItems: "center" },
  nodeNudge: { marginTop: 5 },
  stationGap: { paddingBottom: 20 },
  here: { borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13 },
  why: { marginTop: 11, borderLeftWidth: 2, paddingLeft: 12 },
  blocked: { borderWidth: 1, borderLeftWidth: 3, padding: 16, gap: 8 },
  blockedStation: { borderTopWidth: 1, paddingTop: 10, gap: 4 },
});
