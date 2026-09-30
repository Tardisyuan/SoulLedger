import { soulApi, type MeLife, type MeProfile, type MeRecord } from "@soulledger/core/api/soul";
import { formatHistoricalDate } from "@soulledger/core/domain/dates";
import type { Locale } from "@soulledger/core/config/locale";
import { useFocusEffect, useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { platform } from "@soulledger/core/platform";
import { Fragment, useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Svg, { Line } from "react-native-svg";

import { Emblem, Icon } from "../emblems";
import { family } from "../fonts";
import { useToast } from "../feedback";
import { useI18n } from "../i18n";
import {
  APPLICATION_BADGES,
  LIFE_PATH,
  LIFE_SECTIONS,
  SOUL_STATE_BADGES,
  formatStamp,
  lexiconKey,
  lifePathIndex,
  lifeSectionsOpen,
  residenceOf,
  signedBalance,
  type LifePathStep,
  type LifeSectionKey,
  type Residence,
} from "../rules";
import { SessionContext, useSession } from "../session";
import { sealedTheme, type CivKey } from "../theme";
import {
  Block,
  Button,
  DataRow,
  DataRows,
  EmblemDivider,
  Empty,
  EnumBadge,
  EnumValue,
  FadeIn,
  GUTTER,
  Hairline,
  Screen,
  Section,
  SectionError,
  Skeleton,
  ThemeContext,
  Txt,
  enumText,
  useReducedMotion,
  useReloadOnRefocus,
  useRemote,
  useLayout,
  useTheme,
} from "../ui";
import type { AppStackParams, LifeParams } from "./applications";
import { SentenceSection, useSentencePlan, type SentenceLanding } from "./sentence";

/**
 * The soul app's own names for the six states (在世 / 丢失 / 已结算 …), not the
 * officer console's `souls.states`. A namespace, not a key: messages.test
 * harvests quoted `soul_app.*` literals as keys and checks this one by member.
 */
const SOUL_STATES = ["soul_app", "soul_states"].join(".");

export function realmName(realm: { name_zh: string; name_en: string; name_local: string }, locale: Locale): string {
  return (locale === "zh-Hans" ? realm.name_zh : realm.name_en) || realm.name_local;
}

type SectionKey = Exclude<LifeSectionKey, "sentence" | "past_lives">;

/** Skin by where the soul is (the theme already is); words by where it belongs. */
export function useResidence(): Residence {
  const t = useTheme();
  // Read the context directly: a screen rendered without a session (a test) is simply "at home".
  const session = useContext(SessionContext);
  const me = session?.state.status === "signedIn" ? session.state.profile : null;
  return residenceOf(t.civ, me);
}

function RecordRow({ record, lex }: { record: MeRecord; lex: CivKey }) {
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const { stack } = useLayout();
  const demerit = record.record_type === "DEMERIT";
  const color = demerit ? t.neg : t.pos;
  const milestone = (
    <View testID={`milestone-${record.id}`} style={[styles.milestone, { borderColor: t.ink }]}>
      <Txt variant="label" tone="ink" style={styles.milestoneText}>
        {tr("soul_app.life.milestone")}
      </Txt>
    </View>
  );
  return (
    <View style={styles.record}>
      <View style={styles.recordHead}>
        <View style={[styles.kind, { borderColor: color }]}>
          <Txt variant="label" style={[styles.kindText, { color }]}>
            {tr(lexiconKey(lex, demerit ? "demerit_entry" : "merit_entry"))}
          </Txt>
        </View>
        <View style={styles.shrink}>
          <EnumValue namespace="souls.categories" value={record.category} tone="ink" variant="bodyLg" />
        </View>
        {record.is_milestone && !stack ? milestone : null}
        <View style={styles.fill} />
        <Txt variant="value" tone="muted">{`${demerit ? "−" : "+"}${record.weight}`}</Txt>
      </View>
      {/* Handoff 2d: at large text the mark drops to its own line. */}
      {record.is_milestone && stack ? <View style={styles.milestoneLine}>{milestone}</View> : null}
      {record.description ? (
        <Txt variant="caption" tone="subtle">
          {record.description}
        </Txt>
      ) : null}
      <Txt variant="value" tone="subtle" style={styles.recordDate}>
        {formatHistoricalDate(record.event_date, locale) ?? tr("common.value.unrecorded")}
      </Txt>
    </View>
  );
}

/**
 * One life's record, in collapsible sections. `sealed` renders a past life:
 * no disclosure buttons, no link into an application, ink one step down.
 * A past life offers nothing to act on — not even when a payload says an
 * application in it could be appealed.
 */
export function LifeSections({
  life,
  sealed,
  open,
  onToggle,
  onOpenApplication,
  lex,
  sentence,
}: {
  life: MeLife;
  /** 补足 B11: the current life's sentence section, fifth — after applications. Past lives have none. */
  sentence?: ReactNode;
  /** The lexicon: the soul's HOME civilization. */
  lex: CivKey;
  sealed?: boolean;
  open?: Partial<Record<SectionKey, boolean>>;
  onToggle?: (key: SectionKey) => void;
  onOpenApplication?: (id: string) => void;
}) {
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const unrecorded = tr("common.value.unrecorded");
  const count = (n: number) => (n ? String(n) : tr("soul_app.common.empty"));
  const section = (key: SectionKey) => ({
    testID: `section-${key}`,
    open: sealed ? true : (open?.[key] ?? true),
    onToggle: sealed || !onToggle ? undefined : () => onToggle(key),
  });

  return (
    <>
      <Section title={tr(lexiconKey(lex, "records"))} count={count(life.records.length)} {...section("records")}>
        {life.records.length ? (
          life.records.map((r, i) => (
            <View key={r.id}>
              {i ? <Hairline /> : null}
              <RecordRow record={r} lex={lex} />
            </View>
          ))
        ) : (
          <Empty text={tr("soul_app.life.no_records")} />
        )}
      </Section>
      <Section title={tr(lexiconKey(lex, "judgments"))} count={count(life.judgments.length)} {...section("judgments")}>
        {life.judgments.length ? (
          life.judgments.map((j, i) => (
            <View key={j.id}>
              {i ? <Hairline style={styles.rule} /> : null}
              <DataRows>
                <DataRow label={tr(lexiconKey(lex, "court"))}>{j.court || unrecorded}</DataRow>
                <DataRow label={tr("soul_app.life.judge")}>
                  {j.judge ? (locale === "zh-Hans" ? j.judge.name_zh || j.judge.name : j.judge.name) : unrecorded}
                </DataRow>
                <DataRow label={tr("soul_app.life.verdict")}>
                  {j.verdict ? <EnumValue namespace="judgment.verdicts" value={j.verdict} /> : tr("soul_app.life.verdict_pending")}
                </DataRow>
                <DataRow label={tr("soul_app.life.final")}>{tr(j.is_final ? "soul_app.detail.cross_yes" : "soul_app.detail.cross_no")}</DataRow>
              </DataRows>
            </View>
          ))
        ) : (
          <Empty text={tr("soul_app.life.no_judgments")} />
        )}
      </Section>
      <Section title={tr("soul_app.life.dispositions")} count={count(life.dispositions.length)} {...section("dispositions")}>
        {life.dispositions.length ? (
          life.dispositions.map((d, i) => (
            <View key={d.id}>
              {i ? <Hairline style={styles.rule} /> : null}
              <DataRows>
                <DataRow label={tr("soul_app.life.realm")}>{d.destination_realm ? realmName(d.destination_realm, locale) : unrecorded}</DataRow>
                <DataRow label={tr("soul_app.life.sentence")}>
                  {d.is_eternal
                    ? tr("soul_app.life.eternal")
                    : d.sentence_years !== null
                      ? tr("soul_app.life.sentence_years", { years: String(d.sentence_years) })
                      : unrecorded}
                </DataRow>
                <DataRow label={tr("soul_app.life.execution")}>
                  {tr(d.is_executed ? "soul_app.life.executed" : "soul_app.life.not_executed")}
                </DataRow>
              </DataRows>
            </View>
          ))
        ) : (
          <Empty text={tr("soul_app.life.no_dispositions")} />
        )}
      </Section>
      <Section title={tr("soul_app.life.applications")} count={count(life.rebirth_applications.length)} {...section("applications")}>
        {life.rebirth_applications.length ? (
          <View style={styles.apps}>
            {life.rebirth_applications.map((a) => {
              const summary = (
                <>
                  <View style={[styles.fill, styles.appSummary]}>
                    <EnumBadge namespace="soul_app.status" table={APPLICATION_BADGES} value={a.status} />
                    <EnumValue namespace="reincarnation.forms" value={a.desired_form} tone="ink" variant="bodyLg" />
                    <Txt variant="value" tone="subtle">
                      {formatStamp(a.created_at) ?? unrecorded}
                    </Txt>
                  </View>
                  {onOpenApplication ? (
                    <Txt variant="caption" tone="ink" style={styles.link}>
                      {`${tr("soul_app.applications.view")} →`}
                    </Txt>
                  ) : null}
                </>
              );
              const box = [styles.appCard, { backgroundColor: t.s1, borderColor: t.hair }];
              return onOpenApplication && !sealed ? (
                <Pressable
                  key={a.id}
                  testID={`life-open-${a.id}`}
                  accessibilityRole="button"
                  onPress={() => onOpenApplication(a.id)}
                  style={({ pressed }) => [...box, pressed && styles.pressed]}
                >
                  {summary}
                </Pressable>
              ) : (
                <View key={a.id} style={box}>
                  {summary}
                </View>
              );
            })}
          </View>
        ) : (
          <Empty text={tr("soul_app.life.no_applications")} />
        )}
      </Section>
      {sentence}
    </>
  );
}

function Identity({ me, residence }: { me: MeProfile; residence: Residence }) {
  const t = useTheme();
  const { t: tr, enumLabel } = useI18n();
  const { gutter } = useLayout();
  const civName = (civilization: string | null | undefined) => enumText(enumLabel("souls.civilizations", civilization), tr);
  const toast = useToast();
  const copy = () =>
    Clipboard.setStringAsync(me.soul_code).then(
      () => toast(tr("soul_app.life.code_copied")),
      () => toast(tr("soul_app.life.code_copy_failed"), "failure")
    );
  return (
    <View testID="identity" style={[styles.identity, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
      <View style={styles.civRow}>
        <Emblem civ={t.civ} size={15} stroke={t.inkMuted} />
        <View style={styles.shrink}>
          <EnumValue namespace="souls.civilizations" value={me.civilization} tone="muted" variant="label" />
        </View>
        <View style={[styles.tick, { backgroundColor: t.hair2 }]} />
        <Txt variant="label" tone="subtle">
          {tr("soul_app.life.cycle", { cycle: String(me.account.cycle + 1) })}
        </Txt>
      </View>
      {/* Handoff 3b: the residence mark is a 1px DASHED box in ink-muted — never a colour
          block, so it cannot be read as a state badge — shown only while is_residing. */}
      {residence.residing ? (
        <>
          <View style={[styles.residenceBox, { borderColor: t.hair2 }]}>
            <Txt testID="residence" variant="label" tone="muted" style={styles.residence}>
              {tr("soul_app.life.residing", {
                current: civName(me.civilization),
                home: civName(me.home_civilization),
              })}
            </Txt>
          </View>
          <Txt testID="residence-note" variant="caption" tone="subtle" style={styles.residenceNote}>
            {tr("soul_app.life.residing_note")}
          </Txt>
        </>
      ) : null}
      <View style={styles.nameRow}>
        <Txt variant="display" style={styles.shrink}>
          {me.name}
        </Txt>
        {me.birth_name && me.birth_name !== me.name ? (
          <Txt tone="subtle">{tr("soul_app.life.birth_name", { name: me.birth_name })}</Txt>
        ) : null}
      </View>
      <Pressable
        testID="copy-soul-code"
        accessibilityRole="button"
        accessibilityLabel={`${tr("soul_app.life.soul_code")} ${me.soul_code}`}
        accessibilityHint={tr("soul_app.life.copy_code")}
        onPress={copy}
        style={styles.code}
        hitSlop={8}
      >
        <Txt variant="value" tone="muted" style={styles.codeText}>
          {me.soul_code}
        </Txt>
        <Icon name="copy" size={13} color={t.inkSubtle} strokeWidth={1.2} />
      </Pressable>
      <View style={styles.state}>
        <EnumBadge
          testID="soul-state"
          namespace={SOUL_STATES}
          table={SOUL_STATE_BADGES}
          value={me.current_state}
          label={me.current_state === "JUDGING" ? tr(lexiconKey(residence.home, "judging")) : undefined}
        />
      </View>
    </View>
  );
}

/**
 * 补足 B11: the balance — merit less demerit, in mono 40, in ink: never coloured (a colour
 * would make it a verdict). The two sides the server sends sit beside it, in the soul's
 * home lexicon (Egypt: feather side / heart side). Under it, the life's path.
 */
function Balance({ me, lex, planState }: { me: MeProfile; lex: CivKey; planState: string | undefined }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const side = (word: "merit" | "demerit", value: number) => (
    <View testID={`score-${word}`} style={styles.side}>
      <Txt variant="caption" tone="subtle">
        {tr(lexiconKey(lex, word))}
      </Txt>
      <Txt variant="value" tone="muted">
        {String(value)}
      </Txt>
    </View>
  );
  return (
    <View testID="balance" style={[styles.balance, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
      <View style={styles.balanceHead}>
        <Txt variant="caption" tone="subtle" style={styles.fill}>
          {tr("souls.detail.balance")}
        </Txt>
        {side("merit", me.merit_score)}
        {side("demerit", me.demerit_score)}
      </View>
      <Txt testID="balance-value" style={[styles.balanceValue, { color: t.ink }]}>
        {signedBalance(me.merit_score, me.demerit_score)}
      </Txt>
      <LifePath state={me.current_state} planState={planState} lex={lex} />
    </View>
  );
}

const PATH_WORD: Record<LifePathStep, string> = {
  ALIVE: "soul_app.soul_states.ALIVE",
  JUDGING: "soul_app.soul_states.JUDGING",
  DISPOSED: "soul_app.soul_states.DISPOSED",
  SENTENCE: "soul_app.sentence.section_title",
  REINCARNATING: "soul_app.soul_states.REINCARNATING",
};

/**
 * B11's 行程缩略: the steps passed as solid ink dots on a solid line, where the soul is as
 * a 12pt dot in 匾色, what is ahead hollow on a dashed line. No state to place it (LOST,
 * SETTLED, unknown): nothing is drawn (`lifePathIndex`).
 */
function LifePath({ state, planState, lex }: { state: string; planState: string | undefined; lex: CivKey }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const at = lifePathIndex(state, planState);
  if (at === null) return null;
  const word = (step: LifePathStep) => tr(step === "JUDGING" ? lexiconKey(lex, "judging") : PATH_WORD[step]);
  const here = word(LIFE_PATH[at]);
  return (
    <View testID="life-path" accessible accessibilityLabel={`${tr("souls.detail.ledger.route_title")} · ${here}`} style={styles.path}>
      <View style={styles.pathRow}>
        {LIFE_PATH.map((step, i) => (
          <Fragment key={step}>
            <View
              testID={`path-${step}${i < at ? "-done" : i === at ? "-here" : "-ahead"}`}
              style={
                i < at
                  ? [styles.dot, { backgroundColor: t.ink }]
                  : i === at
                    ? [styles.dotHere, { backgroundColor: t.plaque }]
                    : [styles.dot, styles.dotAhead, { borderColor: t.inkSubtle }]
              }
            />
            {i < LIFE_PATH.length - 1 ? (
              // Walked: a plain 2pt bar, not an SVG line. The SVG's percentage width rounded
              // differently from its neighbours on some screen widths and the last walked
              // segment sat a pixel low (user screenshot, 2026-09-30). Ahead stays SVG: RN
              // has no dependable one-sided dashed border.
              i < at ? (
                <View testID={`path-seg-${i}`} style={[styles.segment, { backgroundColor: t.ink }]} />
              ) : (
                <View testID={`path-seg-${i}`} style={styles.segment}>
                  <Svg width="100%" height={2}>
                    <Line x1={0} y1={1} x2="100%" y2={1} stroke={t.inkSubtle} strokeWidth={2} strokeDasharray="4 3" />
                  </Svg>
                </View>
              )
            ) : null}
          </Fragment>
        ))}
      </View>
      <Txt variant="caption" tone="muted">
        {here}
      </Txt>
    </View>
  );
}

/** Where the life page remembers which sections the soul opened or closed, per soul (B11). */
export const LIFE_OPEN_PREFIX = "soul_app_life_open:";

function readTouched(key: string): Partial<Record<LifeSectionKey, boolean>> {
  try {
    const raw = JSON.parse(platform().persistent.get(key) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(
      Object.entries(raw).filter(([k, v]) => (LIFE_SECTIONS as readonly string[]).includes(k) && typeof v === "boolean")
    ) as Partial<Record<LifeSectionKey, boolean>>;
  } catch {
    return {};
  }
}

/** Where a residing soul's app remembers WHERE it resides (a civilization), per soul. */
export const RESIDENCE_MEMO_PREFIX = "soul_app_residing_in:";

/**
 * Handoff 3b: after a residence ends, ONE card on the life tab says so and asks
 * for an acknowledgement — a card, not a toast, because the skin and the
 * lexicon just changed under the soul. The design stores the acknowledgement
 * server-side (`acknowledged_at`); the API has no such field, so it is kept on
 * this device: the civilization is remembered while `is_residing`, the card
 * shows once it no longer is, and "got it" forgets it.
 */
function Homecoming({ me }: { me: MeProfile }) {
  const theme = useTheme();
  const { t, enumLabel } = useI18n();
  const { gutter } = useLayout();
  const key = `${RESIDENCE_MEMO_PREFIX}${me.soul_code}`;
  // The persistent port reads synchronously, so the store itself is the state; this only re-renders.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (me.is_residing) platform().persistent.set(key, me.civilization);
  }, [key, me.is_residing, me.civilization]);
  const from = me.is_residing ? null : platform().persistent.get(key);
  if (!from) return null;
  const civName = (civilization: string) => enumText(enumLabel("souls.civilizations", civilization), t);
  const home = civName(me.home_civilization);
  const acknowledge = () => {
    platform().persistent.remove(key);
    rerender();
  };
  return (
    <View style={[styles.homecomingWrap, { paddingHorizontal: gutter, borderBottomColor: theme.hair }]}>
      <View testID="homecoming" style={[styles.homecoming, { borderColor: theme.inkSubtle, borderLeftColor: theme.ink, backgroundColor: theme.s1 }]}>
        <View style={styles.homecomingHead}>
          <Emblem civ={theme.civ} size={15} stroke={theme.inkMuted} />
          <Txt variant="bodyLg" style={styles.shrink}>
            {t("soul_app.homecoming.title", { home })}
          </Txt>
        </View>
        <Txt variant="caption" tone="muted">
          {t("soul_app.homecoming.body", { from: civName(from), home })}
        </Txt>
        <Button testID="homecoming-ok" kind="secondary" title={t("soul_app.homecoming.ok")} onPress={acknowledge} />
      </View>
    </View>
  );
}

/**
 * 受刑 1d: a push that lands on the life page's sentence section scrolls it into
 * view — once per landing, with no animation under reduce-motion. The section's
 * top is the sections block's top plus the section's own offset inside it.
 */
export function useScrollToLanding(landing: SentenceLanding | undefined) {
  const ref = useRef<ScrollView>(null);
  const reduced = useReducedMotion();
  const [at, setAt] = useState<{ sections?: number; section?: number }>({});
  const done = useRef<SentenceLanding | undefined>(undefined);
  useEffect(() => {
    if (!landing || done.current === landing || at.sections === undefined || at.section === undefined) return;
    done.current = landing;
    ref.current?.scrollTo({ y: Math.max(0, at.sections + at.section), animated: !reduced });
  }, [landing, at, reduced]);
  const place = useCallback((part: "sections" | "section", y: number) => setAt((a) => (a[part] === y ? a : { ...a, [part]: y })), []);
  return { ref, place };
}

export function MyLifeScreen() {
  const { t, locale } = useI18n();
  const { state, refreshProfile } = useSession();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  // A sentence push landed here (受刑 1d): highlighted until the page is left, then forgotten —
  // the param is the whole record, nothing is stored.
  const landing = useRoute<RouteProp<{ Life: LifeParams }, "Life">>().params?.sentenceLanding;
  useFocusEffect(
    useCallback(() => {
      if (!landing) return;
      return () => (navigation.setParams as (p: LifeParams) => void)({ sentenceLanding: undefined });
    }, [landing, navigation])
  );
  const life = useRemote(soulApi.life);
  const residence = useResidence();
  useReloadOnRefocus(life.reload);
  const [refreshes, setRefreshes] = useState(0);
  const sentence = useSentencePlan({ landing, reloadKey: refreshes });
  const scroll = useScrollToLanding(landing);
  const soulCode = state.status === "signedIn" ? state.profile.soul_code : "";
  const memo = `${LIFE_OPEN_PREFIX}${soulCode}`;
  const [touched, setTouched] = useState(() => readTouched(memo));
  if (state.status !== "signedIn") return null;
  const me = state.profile;
  const planState = sentence.data?.state;
  const open = lifeSectionsOpen(touched, planState);
  const toggle = (key: LifeSectionKey) => {
    const next = { ...touched, [key]: !open[key] };
    setTouched(next);
    platform().persistent.set(memo, JSON.stringify(next));
  };
  const unrecorded = t("common.value.unrecorded");

  const refresh = () => {
    void life.reload();
    setRefreshes((n) => n + 1);
    refreshProfile().catch(() => {});
  };

  return (
    <Screen
      refreshing={life.loading && !!life.data}
      onRefresh={refresh}
      edges={["left", "right"]}
      testID="profile-card"
      scrollRef={scroll.ref}
    >
      <Homecoming me={me} />
      <Identity me={me} residence={residence} />
      <Balance me={me} lex={residence.home} planState={planState} />
      <Block>
        <DataRows>
          <DataRow label={t("soul_app.life.birth")} mono>
            {formatHistoricalDate(me.birth_date, locale) ?? unrecorded}
          </DataRow>
          <DataRow label={t("soul_app.life.death")} mono>
            {formatHistoricalDate(me.death_date, locale) ?? unrecorded}
          </DataRow>
          <DataRow label={t("soul_app.life.origin")}>{me.origin_location || unrecorded}</DataRow>
        </DataRows>
      </Block>
      {life.data ? (
        <FadeIn onLayout={(e) => scroll.place("sections", e.nativeEvent.layout.y)}>
          <LifeSections
            life={life.data}
            lex={residence.home}
            open={open}
            onToggle={toggle}
            onOpenApplication={(id) => navigation.navigate("ApplicationDetail", { id })}
            sentence={
              <SentenceSection
                remote={sentence}
                landing={landing}
                open={open.sentence}
                onToggle={() => toggle("sentence")}
                onPlaced={(y) => scroll.place("section", y)}
              />
            }
          />
        </FadeIn>
      ) : life.error ? (
        <SectionError testID="life-error" onRetry={life.reload} />
      ) : (
        <Block>
          <Skeleton lines={4} testID="life-loading" />
        </Block>
      )}
      <PastLivesSection lex={residence.home} reloadKey={refreshes} open={open.past_lives} onToggle={() => toggle("past_lives")} />
      {/* Round 4: the language switch and sign-out that sat here moved to the settings page. */}
      <View style={styles.foot}>
        <EmblemDivider />
      </View>
    </Screen>
  );
}

function PastLife({ life, open, onToggle, lex }: { life: MeLife; open: boolean; onToggle: () => void; lex: CivKey }) {
  const t = useTheme();
  const { t: tr, enumLabel } = useI18n();
  const sealed = sealedTheme(t);
  const r = life.reincarnation;
  const unrecorded = tr("common.value.unrecorded");
  return (
    <View testID={`past-life-${life.cycle}`} style={[styles.pastLife, { borderBottomColor: t.hair }]}>
      <Pressable
        testID={`past-life-${life.cycle}-toggle`}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => [styles.pastHead, pressed && styles.pressed]}
      >
        <Txt variant="label" tone="subtle" style={styles.pastNo}>
          {tr("soul_app.life.cycle", { cycle: String(life.cycle + 1) })}
        </Txt>
        <View style={styles.fill}>
          <Txt variant="bodyLg" tone="muted">
            {r ? tr("soul_app.past_lives.reborn_as", { form: enumText(enumLabel("reincarnation.forms", r.rebirth_form), tr) }) : unrecorded}
          </Txt>
          <Txt variant="value" tone="subtle">
            {r ? tr("soul_app.past_lives.reborn_on", { date: formatStamp(r.reincarnated_at) ?? unrecorded }) : unrecorded}
          </Txt>
        </View>
        <View style={{ transform: [{ rotate: open ? "0deg" : "-90deg" }], marginTop: 4 }}>
          <Icon name="chevronDown" size={13} color={t.inkSubtle} />
        </View>
      </Pressable>
      {open ? (
        <ThemeContext.Provider value={sealed}>
          <View testID={`sealed-${life.cycle}`} style={[styles.sealed, { borderColor: t.hair, backgroundColor: t.s1 }]}>
            {/* A row of its own, not an absolute corner: at large text an absolute stamp grew past the
                card's reserved top padding and sat on the first section title (功过). */}
            <View style={styles.stampRow}>
              <View testID={`sealed-stamp-${life.cycle}`} style={[styles.stamp, { borderColor: t.hair2 }]}>
                <Txt variant="label" tone="subtle" style={styles.stampText}>
                  {tr("soul_app.past_lives.sealed")}
                </Txt>
              </View>
            </View>
            <LifeSections life={life} sealed lex={lex} />
            <Txt variant="caption" tone="subtle" style={styles.sealedFoot}>
              {tr("soul_app.past_lives.no_actions")}
            </Txt>
          </View>
        </ThemeContext.Provider>
      ) : null}
    </View>
  );
}

/**
 * 前世, folded into the life tab as its last section (朋友圈 handoff 1a: the tab
 * went to 朋友圈). Closed until asked for; its lives open one at a time, sealed.
 */
export function PastLivesSection({
  lex,
  reloadKey,
  open: expanded,
  onToggle,
}: {
  lex: CivKey;
  reloadKey: number;
  open: boolean;
  onToggle: () => void;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const lives = useRemote(soulApi.pastLives);
  const [open, setOpen] = useState<number | null>(null);
  const { reload } = lives;
  useEffect(() => {
    if (reloadKey) void reload();
  }, [reloadKey, reload]);
  return (
    <Section
      testID="section-past_lives"
      title={tr("soul_app.past_lives.title")}
      count={lives.data ? (lives.data.length ? String(lives.data.length) : tr("soul_app.common.empty")) : undefined}
      open={expanded}
      onToggle={onToggle}
    >
      {lives.error && !lives.data ? (
        <SectionError testID="past-lives-error" onRetry={lives.reload} />
      ) : !lives.data ? (
        <Skeleton lines={3} />
      ) : lives.data.length === 0 ? (
        <Empty testID="past-lives-empty" text={tr(lexiconKey(lex, "no_past_lives"))} />
      ) : (
        <View style={[styles.pastList, { borderColor: t.hair }]}>
          {[...lives.data].reverse().map((life) => (
            <PastLife
              key={life.cycle}
              life={life}
              open={open === life.cycle}
              onToggle={() => setOpen((o) => (o === life.cycle ? null : life.cycle))}
              lex={lex}
            />
          ))}
          <View style={[styles.readOnly, { backgroundColor: t.s1 }]}>
            <View style={styles.nudge}>
              <Icon name="lock" size={15} color={t.inkSubtle} strokeWidth={1.2} />
            </View>
            <Txt variant="caption" tone="subtle" style={styles.fill}>
              {tr(lexiconKey(lex, "past_read_only"))} {tr("soul_app.past_lives.end")}
            </Txt>
          </View>
        </View>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.8 },
  link: { textDecorationLine: "underline" },
  noSpacing: { letterSpacing: 0 },
  rule: { marginVertical: 16 },
  record: { paddingVertical: 12, gap: 4 },
  recordHead: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  kind: { minWidth: 18, height: 18, paddingHorizontal: 4, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  kindText: { fontSize: 11, lineHeight: 14, letterSpacing: 0 },
  milestone: { borderWidth: 1, paddingHorizontal: 4, paddingVertical: 2 },
  milestoneText: { fontSize: 11, lineHeight: 14 },
  milestoneLine: { flexDirection: "row" },
  recordDate: { fontSize: 11, opacity: 0.8 },
  apps: { gap: 12 },
  appCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, padding: 16 },
  appSummary: { gap: 8 },
  identity: { overflow: "hidden", paddingHorizontal: GUTTER, paddingTop: 24, paddingBottom: GUTTER, borderBottomWidth: 1 },
  civRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  tick: { width: 1, height: 11 },
  nameRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: 12, marginTop: 12 },
  code: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, alignSelf: "flex-start" },
  codeText: { fontSize: 15, letterSpacing: 2.2, fontFamily: family.mono[500] },
  state: { marginTop: 16 },
  balance: { paddingTop: 16, paddingBottom: 16, borderBottomWidth: 1 },
  balanceHead: { flexDirection: "row", alignItems: "baseline", gap: 12, flexWrap: "wrap" },
  side: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  /** B11: the balance at 40 / 48 in mono — the one number the page is for. */
  balanceValue: { fontFamily: family.mono[400], fontSize: 40, lineHeight: 48 },
  path: { marginTop: 12, gap: 8 },
  pathRow: { flexDirection: "row", alignItems: "center" },
  dot: { width: 8, height: 8 },
  dotHere: { width: 12, height: 12 },
  dotAhead: { borderWidth: 1.5, borderStyle: "dashed" },
  segment: { flex: 1, height: 2 },
  residenceBox: { alignSelf: "flex-start", marginTop: 12, borderWidth: 1, borderStyle: "dashed", paddingHorizontal: 8, paddingVertical: 4 },
  residence: { fontSize: 11, lineHeight: 15, letterSpacing: 0.4 },
  residenceNote: { marginTop: 8 },
  homecomingWrap: { paddingTop: GUTTER, paddingBottom: GUTTER, borderBottomWidth: 1 },
  homecoming: { borderWidth: 1, borderLeftWidth: 3, padding: 16, gap: 12 },
  homecomingHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  foot: { paddingTop: 24, paddingBottom: 32 },
  readOnly: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  pastList: { borderWidth: 1 },
  nudge: { marginTop: 4 },
  pastLife: { borderBottomWidth: 1, opacity: 0.92 },
  pastHead: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingHorizontal: 16, paddingVertical: 16 },
  pastNo: { paddingTop: 4, letterSpacing: 0.8 },
  sealed: { marginHorizontal: 16, marginBottom: 16, borderWidth: 1 },
  stampRow: { flexDirection: "row", justifyContent: "flex-end", paddingTop: 12, paddingHorizontal: 12 },
  stamp: { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  stampText: { fontSize: 11, letterSpacing: 1.6 },
  sealedFoot: { paddingHorizontal: GUTTER, paddingVertical: 12 },
});
