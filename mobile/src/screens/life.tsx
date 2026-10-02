import { soulApi, type MeLife, type MeProfile, type MeRecord } from "@soulledger/core/api/soul";
import { formatHistoricalDate } from "@soulledger/core/domain/dates";
import type { Locale } from "@soulledger/core/config/locale";
import { useFocusEffect, useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { platform } from "@soulledger/core/platform";
import { useCallback, useContext, useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AskGlyph, useAssist } from "../assist";
import { BandPattern, Emblem, Icon, StageMotif } from "../emblems";
import { family } from "../fonts";
import { useToast } from "../feedback";
import { useI18n } from "../i18n";
import {
  APPLICATION_BADGES,
  LIFE_PATH,
  LIFE_SECTIONS,
  SOUL_STATE_BADGES,
  badgeSpec,
  formatStamp,
  grouped,
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
import { OutlineSeal } from "../seal";
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
  SectionLabel,
  SectionError,
  Skeleton,
  ThemeContext,
  Txt,
  enumText,
  shade,
  useReducedMotion,
  useReducedMotionDurations,
  useReloadOnRefocus,
  useRemote,
  useLayout,
  useTheme,
} from "../ui";
import type { AppStackParams, LifeParams } from "./applications";
import { useCurrentHall } from "./letters";
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
  numbered,
}: {
  life: MeLife;
  /** v3: the current life's rows carry their ledger number (01–04 here; 05 受刑, 06 前世 are the caller's). */
  numbered?: boolean;
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
    index: numbered ? LIFE_SECTIONS.indexOf(key) + 1 : undefined,
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

/** v3 .life-identity: compacts once the page has moved 68pt under it, opens again near the top. */
const BAND_COMPACT_AT = 68;
const BAND_OPEN_AT = 20;
/** pt below the status bar, at 1× text: full (12 + meta 16 + 12 + 64pt seal + 12 — the seal is the row's tallest) and compact (one row, 30pt seal). */
const BAND_FULL = 116;
const BAND_SMALL = 48;
/** The soul code's line (`codeText`) and what its copy target adds to reach 44: 28pt of padding. */
const CODE_LINE = 16;
const CODE_REACH = 44 - CODE_LINE;
/** Compact, the room between the code's foot and the band's clipped edge: (48 − (18 + 4 + 16)) / 2. */
const CODE_FOOT_SMALL = 5;

/**
 * v3's identity band, in place of the navigator's plaque on this tab: the civilization's
 * colour (one of its four places) with the seal, the soul's name and code, and — as on every
 * tab's plaque — the account icon. Compact on scroll: one 48pt row, the height moving over
 * `bandCompact` (instant under reduce motion). At ≥ 1.7× text it never compacts and takes the
 * height its words need.
 */
function LifeBand({ me, compact, onAccount }: { me: MeProfile; compact: boolean; onAccount: () => void }) {
  const t = useTheme();
  const { t: tr, enumLabel } = useI18n();
  const { stack } = useLayout();
  const { fontScale, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const hall = useCurrentHall();
  const toast = useToast();
  const { bandCompact } = useReducedMotionDurations();
  const small = compact && !stack;
  const k = Math.max(1, fontScale);
  const [height] = useState(() => new Animated.Value(BAND_FULL * k));
  useEffect(() => {
    Animated.timing(height, { toValue: (small ? BAND_SMALL : BAND_FULL) * k, duration: bandCompact, useNativeDriver: false }).start();
  }, [small, k, bandCompact, height]);
  const on = t.onPlaque;
  const meta = [enumText(enumLabel("souls.civilizations", me.civilization), tr), tr("soul_app.life.cycle", { cycle: String(me.account.cycle + 1) }), hall]
    .filter(Boolean)
    .join(" · ");
  const copy = () =>
    Clipboard.setStringAsync(me.soul_code).then(
      () => toast(tr("soul_app.life.code_copied")),
      () => toast(tr("soul_app.life.code_copy_failed"), "failure")
    );
  return (
    <View testID="plaque" style={{ backgroundColor: t.band, paddingTop: insets.top }}>
      <Animated.View testID="identity" style={[styles.band, stack ? null : { height }, small && styles.bandSmall]}>
        {/* Drawn for the band at its tallest (large text stacks it), clipped by the band as it compacts. */}
        <BandPattern testID="band-pattern" civ={t.civ} color={on} width={width} height={BAND_FULL * Math.max(k, 3)} ringBase={BAND_FULL * k} />
        {small ? null : (
          <Txt testID="identity-meta" numberOfLines={stack ? undefined : 1} style={[styles.bandMeta, { color: on }]}>
            {meta}
          </Txt>
        )}
        <View style={styles.bandRow}>
          <OutlineSeal civ={t.civ} size={small ? 30 : 64} color={on} glyphs={me.tenant.seal_glyphs} label={tr("seal.aria", { court: hall })} testID="plaque-seal" />
          <View testID="band-text" style={styles.bandText}>
            <View style={styles.nameRow}>
              <Txt testID="soul-name" accessibilityRole="header" numberOfLines={stack ? undefined : 1} style={[small ? styles.nameSmall : styles.name, { color: on }]}>
                {me.name}
              </Txt>
              {!small && me.birth_name && me.birth_name !== me.name ? (
                <Txt variant="caption" numberOfLines={stack ? undefined : 1} style={[styles.shrink, { color: on }]}>
                  {tr("soul_app.life.birth_name", { name: me.birth_name })}
                </Txt>
              ) : null}
            </View>
            <Pressable
              testID="copy-soul-code"
              accessibilityRole="button"
              accessibilityLabel={`${tr("soul_app.life.soul_code")} ${me.soul_code}`}
              accessibilityHint={tr("soul_app.life.copy_code")}
              onPress={copy}
              // The row is 16pt (the code's line). It used to be `hitSlop={12}`: 40 at best, and less
              // on Android, which routes a touch outside a parent only into its children's laid-out
              // boxes (TouchTargetHelper's overflow inset) — never into a slop — and this row is
              // the bottom of `bandText`. The 44pt target is the Pressable's own box instead:
              // padding grown, margins pulled back by the same, so nothing moves (`codeTarget*`).
              // Compact, mostly upward: the band clips (overflow hidden) 5pt under the code.
              style={[styles.code, small ? styles.codeTargetSmall : styles.codeTarget]}
            >
              <Txt variant="value" style={[styles.codeText, { color: on }]}>
                {me.soul_code}
              </Txt>
              <Icon name="copy" size={13} color={on} strokeWidth={1.2} />
            </Pressable>
          </View>
          <Pressable
            testID="header-account"
            accessibilityRole="button"
            accessibilityLabel={tr("soul_app.settings.title")}
            onPress={onAccount}
            style={({ pressed }) => [styles.account, pressed && { backgroundColor: `${on}22` }]}
          >
            <Icon name="person" size={18} color={on} strokeWidth={1.2} />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

/**
 * Handoff 3b: the residence mark is a 1px DASHED box in ink-muted — never a colour block, so
 * it cannot be read as a state badge — shown only while is_residing. Under the band in v3.
 */
function ResidenceNote({ me }: { me: MeProfile }) {
  const t = useTheme();
  const { t: tr, enumLabel } = useI18n();
  const { gutter } = useLayout();
  const civName = (civilization: string | null | undefined) => enumText(enumLabel("souls.civilizations", civilization), tr);
  return (
    <View style={[styles.residenceWrap, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
      <View style={[styles.residenceBox, { borderColor: t.inkMuted }]}>
        <Txt testID="residence" variant="label" tone="muted" style={styles.residence}>
          {tr("soul_app.life.residing", { current: civName(me.civilization), home: civName(me.home_civilization) })}
        </Txt>
      </View>
      <Txt testID="residence-note" variant="caption" tone="subtle" style={styles.residenceNote}>
        {tr("soul_app.life.residing_note")}
      </Txt>
    </View>
  );
}

const two = (n: number) => String(n).padStart(2, "0");

/**
 * v3 .life-now 「你现在在哪」: the soul's state, glyph and word (never colour alone), then —
 * when the state has a place on the road — 「本世阶段 02 / 05」 and the five stages.
 */
function Now({ me, lex, planState }: { me: MeProfile; lex: CivKey; planState: string | undefined }) {
  const t = useTheme();
  const { t: tr, enumLabel } = useI18n();
  const { gutter } = useLayout();
  // EnumBadge's reading: a member the bundles cannot name keeps the unknown shape and its raw value.
  const d = enumLabel(SOUL_STATES, me.current_state);
  const spec = badgeSpec(SOUL_STATE_BADGES, d.raw, d.state === "known");
  const word = spec.unknown
    ? `${tr(d.state === "missing" ? "common.value.unrecorded" : "common.value.unrecognized")}${d.raw ? ` (${d.raw})` : ""}`
    : me.current_state === "JUDGING"
      ? tr(lexiconKey(lex, "judging"))
      : enumText(d, tr);
  const at = lifePathIndex(me.current_state, planState);
  return (
    <View testID="life-now" style={[styles.now, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
      <StageMotif testID="stage-motif" civ={t.civ} color={t.plaque} />
      <Txt variant="caption" tone="muted">
        {tr("soul_app.life.here")}
      </Txt>
      <View testID="soul-state" accessible accessibilityLabel={word} style={styles.nowState}>
        <Txt testID="soul-state-glyph" style={styles.nowGlyph}>
          {spec.glyph}
        </Txt>
        <Txt testID="soul-state-word" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={styles.nowWord}>
          {word}
        </Txt>
      </View>
      {at === null ? null : (
        <>
          <Txt testID="life-stage" variant="value" tone="muted" style={styles.small}>
            {tr("soul_app.life.stage", { at: two(at + 1), total: two(LIFE_PATH.length) })}
          </Txt>
          <LifePath at={at} lex={lex} />
        </>
      )}
    </View>
  );
}

/**
 * v3 .life-balance: merit less demerit, the one number the page is for, in mono on an ink
 * block — never in a status colour (a colour would make it a verdict). The two sides the
 * server sends beside it, in the soul's home lexicon (Egypt: feather side / heart side).
 */
function Balance({ me, lex }: { me: MeProfile; lex: CivKey }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const on = { color: t.s1 };
  const side = (word: "merit" | "demerit", value: number) => (
    <View testID={`score-${word}`} style={styles.side}>
      <Txt variant="caption" style={[on, styles.dim]}>
        {tr(lexiconKey(lex, word))}
      </Txt>
      <Txt variant="value" style={on}>
        {grouped(value)}
      </Txt>
    </View>
  );
  return (
    <View testID="balance" style={[styles.balance, { paddingHorizontal: gutter, backgroundColor: t.ink }]}>
      <View style={styles.fill}>
        <Txt variant="caption" style={[on, styles.dim]}>
          {tr("soul_app.life.balance")}
        </Txt>
        <Txt testID="balance-value" numberOfLines={1} adjustsFontSizeToFit style={[styles.balanceValue, on]}>
          {signedBalance(me.merit_score, me.demerit_score)}
        </Txt>
      </View>
      {side("merit", me.merit_score)}
      {side("demerit", me.demerit_score)}
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
 * v3 .life-stages: five 30pt circles on one line. Passed: solid ink with ✓; here: ink inside a
 * canvas ring and an ink outline, its word in ink 600; ahead: an outline and its number. v3
 * paints "here" in the civilization's colour; this page keeps that colour to the band, the seal
 * and the ask button (user rule), so "here" is told by its ring, its number and its weight.
 */
function LifePath({ at, lex }: { at: number; lex: CivKey }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const word = (step: LifePathStep) => tr(step === "JUDGING" ? lexiconKey(lex, "judging") : PATH_WORD[step]);
  const span = 100 / LIFE_PATH.length;
  return (
    <View testID="life-path" accessible accessibilityLabel={`${tr("souls.detail.ledger.route_title")} · ${word(LIFE_PATH[at])}`} style={styles.path}>
      {LIFE_PATH.slice(1).map((step, i) => (
        <View
          key={step}
          testID={`path-seg-${i}`}
          style={[styles.segment, { left: `${span * (i + 0.5)}%`, width: `${span}%`, backgroundColor: i < at ? t.ink : t.hair }]}
        />
      ))}
      {LIFE_PATH.map((step, i) => {
        const where = i < at ? "done" : i === at ? "here" : "ahead";
        return (
          <View key={step} style={styles.stage}>
            <View style={[styles.stageRing, where === "here" && { borderColor: t.ink }]}>
              <View
                testID={`path-${step}-${where}`}
                style={[
                  styles.stageDot,
                  where === "ahead"
                    ? { backgroundColor: t.s0, borderColor: t.hair }
                    : where === "here"
                      ? [styles.stageHere, { backgroundColor: t.ink, borderColor: t.s0 }]
                      : { backgroundColor: t.ink, borderColor: t.ink },
                ]}
              >
                <Txt style={[styles.stageMark, { color: where === "ahead" ? t.inkMuted : t.s0 }]}>{where === "done" ? "✓" : String(i + 1)}</Txt>
              </View>
            </View>
            <Txt
              testID={`path-${step}-word`}
              numberOfLines={2}
              style={[styles.stageWord, { color: where === "here" ? t.ink : t.inkMuted, fontFamily: family.ui[where === "here" ? 600 : 400] }]}
            >
              {word(step)}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

/** v3 「问一问」: a 48pt circle in the civilization's colour (the page's primary action), over its foot. */
function AskButton() {
  const t = useTheme();
  const { t: tr } = useI18n();
  const assist = useAssist();
  if (!assist?.visible) return null;
  return (
    <Pressable
      testID="assist-entry"
      accessibilityRole="button"
      accessibilityLabel={tr("soul_app.assist.entry_label")}
      onPress={() => assist.open("life")}
      style={({ pressed }) => [styles.ask, { backgroundColor: pressed ? shade(t.plaqueFill) : t.plaqueFill }]}
    >
      <AskGlyph color={t.onPlaque} />
    </Pressable>
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
  const [compact, setCompact] = useState(false);
  const theme = useTheme();
  const { gutter } = useLayout();
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
    <View testID="life" style={[styles.fill, { backgroundColor: theme.s0 }]}>
      <LifeBand me={me} compact={compact} onAccount={() => navigation.navigate("Settings")} />
      <Screen
        refreshing={life.loading && !!life.data}
        onRefresh={refresh}
        edges={["left", "right"]}
        testID="profile-card"
        scrollRef={scroll.ref}
        onScroll={(y) => setCompact((c) => (c ? y > BAND_OPEN_AT : y > BAND_COMPACT_AT))}
      >
        <Homecoming me={me} />
        {residence.residing ? <ResidenceNote me={me} /> : null}
        <Now me={me} lex={residence.home} planState={planState} />
        <Balance me={me} lex={residence.home} />
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
        {/* v3 .life-records: 「本世账目」 and its six numbered rows. */}
        <View testID="ledger-head" style={[styles.ledgerHead, { paddingHorizontal: gutter, backgroundColor: theme.s1, borderBottomColor: theme.hair }]}>
          <SectionLabel style={styles.fill}>{t("soul_app.life.ledger")}</SectionLabel>
          <Txt variant="caption" tone="subtle">
            {t("soul_app.life.ledger_hint")}
          </Txt>
        </View>
        {life.data ? (
          <FadeIn onLayout={(e) => scroll.place("sections", e.nativeEvent.layout.y)}>
            <LifeSections
              life={life.data}
              lex={residence.home}
              numbered
              open={open}
              onToggle={toggle}
              onOpenApplication={(id) => navigation.navigate("ApplicationDetail", { id })}
              sentence={
                <SentenceSection
                  index={5}
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
        <PastLivesSection index={6} lex={residence.home} reloadKey={refreshes} open={open.past_lives} onToggle={() => toggle("past_lives")} />
        {/* Round 4: the language switch and sign-out that sat here moved to the settings page. */}
        <View style={styles.foot}>
          <EmblemDivider />
        </View>
      </Screen>
      <AskButton />
    </View>
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
  index,
}: {
  lex: CivKey;
  reloadKey: number;
  /** v3: its number in the life tab's ledger (06). */
  index?: number;
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
      index={index}
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
  /** v3 .life-identity: 116pt (meta line, seal row) → 48pt (one row) on scroll. */
  band: { overflow: "hidden", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 12 },
  bandSmall: { paddingVertical: 0, paddingLeft: 12, paddingRight: 4, justifyContent: "center" },
  bandMeta: { fontFamily: family.mono[400], fontSize: 11, lineHeight: 16, letterSpacing: 0.6 },
  bandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  bandText: { flex: 1, minWidth: 0, gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "baseline", columnGap: 8 },
  name: { fontFamily: family.ui[600], fontSize: 20, lineHeight: 28, flexShrink: 1 },
  nameSmall: { fontFamily: family.ui[600], fontSize: 13, lineHeight: 18, flexShrink: 1 },
  code: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" },
  /** 16 + 14 + 14 = 44. Full, the band has room below the row for the even split. */
  codeTarget: { paddingVertical: CODE_REACH / 2, marginVertical: -CODE_REACH / 2 },
  /** 16 + 23 + 5 = 44, kept inside the 48pt compact band (its code row ends 5pt above the edge). */
  codeTargetSmall: { paddingTop: CODE_REACH - CODE_FOOT_SMALL, paddingBottom: CODE_FOOT_SMALL, marginTop: -(CODE_REACH - CODE_FOOT_SMALL), marginBottom: -CODE_FOOT_SMALL },
  codeText: { fontSize: 11, lineHeight: CODE_LINE, letterSpacing: 1.6, fontFamily: family.mono[500] },
  account: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  /** v3 .life-now. */
  now: { paddingTop: 24, paddingBottom: 24, alignItems: "center", gap: 8, borderBottomWidth: 1, overflow: "hidden" },
  /** v3 .life-current: the glyph over the word, both 56; the word in the title serif (Noto Serif SC 600). One line, shrinking to fit (a long English state). */
  nowState: { alignSelf: "stretch", alignItems: "center", marginTop: 8 },
  nowGlyph: { fontSize: 56, lineHeight: 64 },
  nowWord: { fontFamily: family.title, fontSize: 56, lineHeight: 64, textAlign: "center" },
  small: { fontSize: 11, lineHeight: 16 },
  path: { alignSelf: "stretch", flexDirection: "row", marginTop: 16 },
  /** The line behind the circles, centre to centre: walked in ink, ahead in the hairline. */
  segment: { position: "absolute", top: 14, height: 2 },
  stage: { flex: 1, alignItems: "center", gap: 8 },
  stageRing: { width: 30, height: 30, borderRadius: 999, borderWidth: 1, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  stageDot: { width: 30, height: 30, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stageHere: { width: 28, height: 28, borderWidth: 4 },
  stageMark: { fontFamily: family.mono[400], fontSize: 11, lineHeight: 14 },
  stageWord: { fontSize: 11, lineHeight: 16, textAlign: "center" },
  /** v3 .life-balance: an ink block, the number in mono 56. */
  balance: { minHeight: 120, flexDirection: "row", alignItems: "center", gap: 24, paddingVertical: 24 },
  side: { alignItems: "flex-start", gap: 4 },
  dim: { opacity: 0.72 },
  balanceValue: { fontFamily: family.mono[500], fontSize: 56, lineHeight: 64, letterSpacing: -2 },
  ledgerHead: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1 },
  ask: { position: "absolute", right: 16, bottom: 16, width: 48, height: 48, borderRadius: 999, alignItems: "center", justifyContent: "center" },
  residenceWrap: { paddingTop: 12, paddingBottom: 12, borderBottomWidth: 1 },
  residenceBox: { alignSelf: "flex-start", borderWidth: 1, borderStyle: "dashed", paddingHorizontal: 8, paddingVertical: 4 },
  residence: { fontSize: 11, lineHeight: 15, letterSpacing: 0.4 },
  residenceNote: { marginTop: 8 },
  homecomingWrap: { paddingTop: GUTTER, paddingBottom: GUTTER, borderBottomWidth: 1 },
  homecoming: { borderWidth: 1, borderLeftWidth: 3, padding: 16, gap: 12 },
  homecomingHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  /** Room under the divider for the ask button, which floats at the right over the foot. */
  foot: { paddingTop: 24, paddingBottom: 48 },
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
