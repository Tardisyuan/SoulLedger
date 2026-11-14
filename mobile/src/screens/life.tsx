import { courtLabel } from "@soulledger/core/domain/courts";
import { thisLifeLabel } from "@soulledger/core/domain/lifeLabel";
import { soulApi, soulErrorMessage, type MeJudgmentAppealList, type MeLife, type MeProfile, type MeRecord, type MeWangsiCase } from "@soulledger/core/api/soul";
import { formatHistoricalDate, pad2 } from "@soulledger/core/domain/dates";
import { verdictNamespace } from "@soulledger/core/domain/verdictNames";
import { civKey, realmPlace } from "@soulledger/core/domain/sentenceNodeStates";
import { useFocusEffect, useNavigation, useRoute, type NavigationProp, type RouteProp } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { platform } from "@soulledger/core/platform";
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode, type Ref, type RefObject } from "react";
import { Animated, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AskGlyph, useAssist } from "../assist";
import { HeadMark, HeadTexture, Topline, markFits } from "../civHead";
import { Emblem, GlowTop, Icon, StageMotif } from "../emblems";
import { DossierSeal, MeritMark } from "../dossierMarks";
import { family, titleFamily } from "../fonts";
import { useToast } from "../feedback";
import { useGone } from "../gone";
import { useI18n } from "../i18n";
import {
  APPLICATION_BADGES,
  LIFE_SECTIONS,
  SOUL_STATE_BADGES,
  badgeSpec,
  formatStamp,
  grouped,
  lexiconKey,
  lifePath,
  lifePathIndex,
  lifeSectionsOpen,
  signedBalance,
  type LifePathStep,
  type LifeSectionKey,
} from "../rules";
import { useSession } from "../session";
import { OutlineSeal } from "../seal";
import { radius, sealedTheme, type CivKey } from "../theme";
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
  LandingWash,
  OneLine,
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
import type { AppStackParams, LifeFocus, LifeParams } from "../navTypes";
import { realmName, useResidence } from "../residence";
import { AppealDeadlineNote, AppealLine, roundsOf } from "./appeals";
import { ContactEmailNudge } from "./contactEmail";
import { WangsiLine } from "./wangsi";
import { CaptureCard, CaptureLine, ConfessionCard, DeliveredRow, FerryCard, VestibuleCard } from "./lifeProgress";
import { useCurrentHall } from "../useCurrentHall";
import { SentenceSection, useSentencePlan, type SentenceLanding } from "./sentence";
import { formatSoulCode, spellSoulCode } from "@soulledger/core/domain/soulCode";
import { DIYU_STATIONS, diyuStationOrdinal } from "@soulledger/core/domain/diyuStations";
import { useLiveProgress } from "../liveProgress";
import { soulRoute, type RouteStep, type SoulRoute } from "@soulledger/core/domain/soulRoute";

/** 「刑期」 in 十殿, 「停留期」 in 天界, 「涤罪期」 in 炼狱 (v4 batch 12 §1.4): the place is the disposition's realm. */
const placeKeyOf = (t: (key: string) => string, key: string, realmCode: string | null | undefined, greekAccount?: string) => {
  const { civ, type } = realmPlace(realmCode);
  return civKey(t, key, civ, type, greekAccount);
};

/**
 * The soul app's own names for the six states (在世 / 丢失 / 已结算 …), not the
 * officer console's `souls.states`. A namespace, not a key: messages.test
 * harvests quoted `soul_app.*` literals as keys and checks this one by member.
 */
const SOUL_STATES = ["soul_app", "soul_states"].join(".");

type SectionKey = Exclude<LifeSectionKey, "sentence" | "past_lives">;

/** 地府's seal reads 「第N殿印」: the court's number, from `court_5` or 「第五殿」; null when the court says none. */
function courtNumber(court: string | null | undefined): number | null {
  const digits = /(\d+)/.exec(court ?? "");
  if (digits) return Number(digits[1]);
  const han = /第([一二三四五六七八九十]+)殿/.exec(court ?? "");
  return han ? "一二三四五六七八九十".indexOf(han[1]) + 1 || null : null;
}

/**
 * 灵魂端的印 (batch 30 step 3 section 8·7): a final verdict shows the civilization's seal at 72; before that a
 * dashed preview and one line saying the seal will appear. Nothing for a soul with no civilization, or a 地府
 * judgment whose court has no number to read.
 */
function VerdictSeal({ civ, judgment }: { civ: CivKey; judgment: MeLife["judgments"][number] }) {
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const court = courtNumber(judgment.court);
  if (civ === "neutral" || (civ === "cn" && court === null)) return null;
  const set = Boolean(judgment.is_final && judgment.verdict);
  return (
    <View testID={`verdict-seal-${judgment.id}`} style={styles.verdictSeal}>
      <DossierSeal
        civ={civ}
        scheme={t.scheme}
        pending={!set}
        court={court ?? 1}
        testID={`seal-${set ? "set" : "pending"}-${judgment.id}`}
        label={set ? tr("seal.aria", { court: courtLabel(tr, judgment.court, locale) }) : undefined}
      />
      <View style={styles.fill}>
        <Txt variant="caption" tone="subtle">
          {tr("soul_app.life.seal_title")}
        </Txt>
        {set ? null : (
          <Txt variant="caption" tone="subtle">
            {tr("soul_app.life.seal_pending")}
          </Txt>
        )}
      </View>
    </View>
  );
}

function RecordRow({ record, lex }: { record: MeRecord; lex: CivKey }) {
  const t = useTheme();
  const { t: tr, locale } = useI18n();
  const { stack } = useLayout();
  const demerit = record.record_type === "DEMERIT";
  const color = demerit ? t.neg : t.pos;
  const ref = record.statute_snapshot;
  const statute = ref ? `${ref.code} ${ref.title[locale === "zh-Hans" ? "zh" : locale === "egy" ? "egy" : "en"] ?? ""}`.trim() : "";
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
        {/* 卷宗 batch 30: the mark says merit or demerit by shape, in ink; the colour is the signed number's. */}
        <View accessible accessibilityLabel={tr(lexiconKey(lex, demerit ? "demerit_entry" : "merit_entry"))} style={styles.kind}>
          <MeritMark testID={`mark-${record.id}`} civ={lex} demerit={demerit} ink={t.ink} ground={t.s0} />
        </View>
        <View style={styles.shrink}>
          <EnumValue namespace="souls.categories" value={record.category} tone="ink" variant="bodyLg" />
        </View>
        {/* 第五十二批 A-5:改判补偿用自己的类别名,后面一枚小方标「↺ 改判」(同网页超度回向的「⇠ 阳间」形制)。 */}
        {record.category === "COMPENSATION" ? (
          <View testID={`compensation-tag-${record.id}`} style={[styles.milestone, { borderColor: t.inkSubtle }]}>
            <Txt variant="label" tone="muted" style={styles.milestoneText}>
              {tr("souls.compensation.tag")}
            </Txt>
          </View>
        ) : null}
        {record.is_milestone && !stack ? milestone : null}
        <View style={styles.fill} />
        <OneLine variant="value" style={{ color }}>{`${demerit ? "−" : "+"}${record.weight}`}</OneLine>
      </View>
      {/* Handoff 2d: at large text the mark drops to its own line. */}
      {record.is_milestone && stack ? <View style={styles.milestoneLine}>{milestone}</View> : null}
      {record.description ? (
        <Txt variant="caption" tone="subtle">
          {record.description}
        </Txt>
      ) : null}
      {/* 依据与人生阶段;证据来源 / 说明服务端不给,这里也不读。 */}
      {statute || record.life_stage ? (
        <View style={styles.basisLine}>
          {statute ? (
            <Txt variant="caption" tone="subtle" testID={`record-statute-${record.id}`}>
              {`${tr("soul_app.life.basis")} ${statute}`}
            </Txt>
          ) : null}
          {record.life_stage ? (
            <View testID={`record-stage-${record.id}`}>
              <EnumValue namespace="souls.life_stages" value={record.life_stage} tone="subtle" variant="caption" />
            </View>
          ) : null}
        </View>
      ) : null}
      <OneLine variant="value" tone="subtle" style={styles.recordDate}>
        {formatHistoricalDate(record.event_date, locale) ?? tr("common.value.unrecorded")}
      </OneLine>
    </View>
  );
}

function WangsiCaseLine({ row, deliveredRef }: { row: MeWangsiCase | undefined; deliveredRef?: Ref<View> }) {
  return <WangsiLine row={row} landingRef={row?.grievance_status === "DELIVERED" ? deliveredRef : undefined} />;
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
  focus,
  appeals,
  wangsi,
  confession,
  deliveredRef,
  greekAccount,
}: {
  life: MeLife;
  /** 希腊本世按哪篇文书判的(`/me/sentence-plan/` 的 greek_account):《理想国》读「天上 n 年」(第十二批 GR 9)。只有当前这一世传。 */
  greekAccount?: string;
  /** 第六十二批:四十二条否定告白,紧贴审判那一格上方(只有当前这一世传)。 */
  confession?: ReactNode;
  /** 推送「已超度」的落点:超度了的那件枉死案子底部那一行。 */
  deliveredRef?: Ref<View>;
  /** 枉死城:本世枉死的案子(只有当前这一世传)。 */
  wangsi?: MeWangsiCase[] | null;
  /** 第五十二批:本世审判的申诉(只有当前这一世传;前世只能看,不画申诉行)。 */
  appeals?: { data: MeJudgmentAppealList | null; reload: () => unknown };
  /** The row a tapped push points at (第四十批 S-e): a judgment or a disposition, washed for two seconds. */
  focus?: LifeFocus;
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
  const gone = useGone();
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
      {confession}
      <Section title={tr(lexiconKey(lex, "judgments"))} count={count(life.judgments.length)} {...section("judgments")}>
        {life.judgments.length ? (
          life.judgments.map((j, i) => (
            <LandingWash key={j.id} on={focus?.judgment === j.id} testID={`judgment-${j.id}`}>
              {i ? <Hairline style={styles.rule} /> : null}
              <DataRows>
                <DataRow label={tr(lexiconKey(lex, "court"))}>{courtLabel(tr, j.court, locale) || unrecorded}</DataRow>
                <DataRow label={tr("soul_app.life.judge")}>
                  {j.judge ? (locale === "zh-Hans" ? j.judge.name_zh || j.judge.name : j.judge.name) : unrecorded}
                </DataRow>
                <DataRow label={tr("soul_app.life.verdict")}>
                  {/* 埃及:裁决是天平的(docs/02 §5)。摇摆 = 另开一次称量,不读作「待定」。 */}
                  {j.weighing_result === "WAVERING" ? (
                    tr("judgment.weighing.result.WAVERING")
                  ) : j.verdict ? (
                    // PURGATORY 按灵魂原属文明叫(欧洲炼狱;第十一批 1a)。
                    <EnumValue namespace={verdictNamespace(tr, lex, j.verdict)} value={j.verdict} />
                  ) : (
                    tr("soul_app.life.verdict_pending")
                  )}
                </DataRow>
                {j.weighing_result && j.weighing_result !== "WAVERING" ? (
                  <DataRow label={tr("judgment.weighing.title")} testID={`weighing-${j.id}`}>
                    {tr(`judgment.weighing.result.${j.weighing_result}`)}
                  </DataRow>
                ) : null}
                <DataRow label={tr("soul_app.life.final")}>{tr(j.is_final ? "soul_app.detail.cross_yes" : "soul_app.detail.cross_no")}</DataRow>
              </DataRows>
              <VerdictSeal civ={lex} judgment={j} />
              {appeals?.data && !sealed ? (
                <AppealLine
                  row={appeals.data.judgments.find((a) => a.judgment_id === j.id)}
                  rounds={roundsOf(appeals.data, j.id)}
                  focused={focus?.judgment === j.id}
                  onChanged={() => void appeals.reload()}
                />
              ) : null}
              {wangsi && !sealed ? <WangsiCaseLine row={wangsi.find((w) => w.judgment_id === j.id)} deliveredRef={deliveredRef} /> : null}
            </LandingWash>
          ))
        ) : (
          <Empty text={tr("soul_app.life.no_judgments")} />
        )}
      </Section>
      <Section title={tr("soul_app.life.dispositions")} count={count(life.dispositions.length)} {...section("dispositions")}>
        {life.dispositions.length ? (
          life.dispositions.map((d, i) => (
            <LandingWash key={d.id} on={focus?.disposition === d.id} testID={`disposition-${d.id}`}>
              {i ? <Hairline style={styles.rule} /> : null}
              <DataRows>
                <DataRow label={tr("soul_app.life.realm")}>{d.destination_realm ? realmName(d.destination_realm, locale) : unrecorded}</DataRow>
                <DataRow label={tr(placeKeyOf(tr, "soul_app.life.sentence", d.destination_realm?.realm_code, greekAccount))}>
                  {d.is_eternal
                    ? tr("soul_app.life.eternal")
                    : d.sentence_years !== null
                      ? tr(placeKeyOf(tr, "soul_app.life.sentence_years", d.destination_realm?.realm_code, greekAccount), { years: String(d.sentence_years) })
                      : unrecorded}
                </DataRow>
                <DataRow label={tr("soul_app.life.execution")}>
                  {tr(d.is_executed ? "soul_app.life.executed" : "soul_app.life.not_executed")}
                </DataRow>
              </DataRows>
            </LandingWash>
          ))
        ) : (
          <Empty text={tr("soul_app.life.no_dispositions")} />
        )}
      </Section>
      <Section title={tr("soul_app.life.applications")} count={count(life.rebirth_applications.length)} {...section("applications")}>
        {life.rebirth_applications.length ? (
          <View style={styles.apps}>
            {life.rebirth_applications.map((a) => {
              // O-c: an application whose detail turned out to be gone is greyed and opens nothing, like a sealed one.
              const dead = gone.has(`application:${a.id}`);
              const opens = onOpenApplication && !sealed && !dead;
              const summary = (
                <>
                  <View style={[styles.fill, styles.appSummary]}>
                    <EnumBadge namespace="soul_app.status" table={APPLICATION_BADGES} value={a.status} />
                    <EnumValue namespace="reincarnation.forms" value={a.desired_form} tone="ink" variant="bodyLg" />
                    <OneLine variant="value" tone="subtle" onPress={opens ? () => onOpenApplication?.(a.id) : undefined}>
                      {formatStamp(a.created_at) ?? unrecorded}
                    </OneLine>
                  </View>
                  {onOpenApplication && !dead ? (
                    <Txt variant="caption" tone="ink" style={styles.link}>
                      {`${tr("soul_app.applications.view")} →`}
                    </Txt>
                  ) : null}
                </>
              );
              const box = [styles.appCard, { backgroundColor: t.s1, borderColor: t.hair }, dead && styles.gone];
              return opens ? (
                <Pressable
                  key={a.id}
                  testID={`life-open-${a.id}`}
                  accessibilityRole="button"
                  onPress={() => onOpenApplication?.(a.id)}
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
/** The head mark's right: the band's 16, the account icon's 44, then 16 (第四十六批第三节: 20 + the buttons + 16). */
const MARK_RIGHT = 16 + 44 + 16;
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
  // v4 (V4Batch07 05 App): no band — the page's ground with the header light, the seal in the civilization's
  // colour, the name in the serif at 30/38 and everything else in the page's inks.
  const on = t.ink;
  const meta = [enumText(enumLabel("souls.civilizations", me.civilization), tr), thisLifeLabel(tr, me.civilization, me.account.cycle + 1) ?? tr("soul_app.life.cycle", { cycle: String(me.account.cycle + 1) }), hall]
    .filter(Boolean)
    .join(" · ");
  // 第四十六批 页头记号: right of the text, left of the account icon (20 → this band's 16, + 44 + 16), and only while
  // the meta line and the name end 24 short of it (`markFits`). Measured: until then it is laid out but not shown.
  const [fit, setFit] = useState<Record<"meta" | "textX" | "name" | "mark", number | undefined>>({ meta: undefined, textX: undefined, name: undefined, mark: undefined });
  const measure = (key: keyof typeof fit) => (value: number) => setFit((p) => (p[key] === value ? p : { ...p, [key]: value }));
  const markShown =
    fit.meta !== undefined && fit.textX !== undefined && fit.name !== undefined && fit.mark !== undefined && markFits(Math.max(16 + fit.meta, 16 + fit.textX + fit.name), width - MARK_RIGHT - fit.mark);
  const copy = () =>
    Clipboard.setStringAsync(me.soul_code).then(
      () => toast(tr("soul_app.life.code_copied")),
      () => toast(tr("soul_app.life.code_copy_failed"), "failure")
    );
  return (
    <View testID="plaque" style={[styles.bandFrame, { backgroundColor: t.s0, paddingTop: insets.top }]}>
      <GlowTop testID="band-glow" color={t.glow} scheme={t.scheme} width={width} height={insets.top + BAND_FULL * k} />
      <Topline />
      <Animated.View testID="identity" style={[styles.band, stack ? null : { height }, small && styles.bandSmall]}>
        {/* Drawn for the band at its tallest (large text stacks it), clipped by the band as it compacts. */}
        {/* 第四十六批: the paper texture in ink, in place of the civilization-coloured pattern; this is a first-level page. */}
        <HeadTexture testID="band-texture" width={width} height={BAND_FULL * Math.max(k, 3)} />
        {small ? null : (
          <HeadMark names={me.tenant.hall_names} right={MARK_RIGHT} hidden={!markShown} onLayout={(e) => measure("mark")(e.nativeEvent.layout.width)} />
        )}
        {small ? null : (
          <Txt
            testID="identity-meta"
            numberOfLines={stack ? undefined : 1}
            onTextLayout={(e) => measure("meta")(Math.max(0, ...e.nativeEvent.lines.map((l) => l.width)))}
            style={[styles.bandMeta, { color: t.inkMuted }]}
          >
            {meta}
          </Txt>
        )}
        <View style={styles.bandRow}>
          <OutlineSeal civ={t.civ} size={small ? 30 : 64} color={t.plaque} glyphs={me.tenant.seal_glyphs} label={tr("seal.aria", { court: hall })} testID="plaque-seal" />
          <View testID="band-text" onLayout={(e) => measure("textX")(e.nativeEvent.layout.x)} style={styles.bandText}>
            <View testID="name-row" onLayout={(e) => measure("name")(e.nativeEvent.layout.width)} style={styles.nameRow}>
              <Txt testID="soul-name" accessibilityRole="header" numberOfLines={stack ? undefined : 1} style={[small ? styles.nameSmall : styles.name, { color: on, fontFamily: titleFamily(me.name) }]}>
                {me.name}
              </Txt>
              {/* 出身部洲是名字的副标(第五十七批 S-2):「钱谦益 · 南瞻部洲」。只地府、登记了才写。 */}
              {!small && me.civilization === "CHINESE" && me.birth_continent ? (
                <Txt testID="soul-continent" variant="caption" numberOfLines={1} style={[styles.shrink, { color: on }]}>
                  {`· ${enumText(enumLabel("souls.birth_continent", me.birth_continent), tr)}`}
                </Txt>
              ) : null}
              {!small && me.birth_name && me.birth_name !== me.name ? (
                <Txt variant="caption" numberOfLines={stack ? undefined : 1} style={[styles.shrink, { color: on }]}>
                  {tr("soul_app.life.birth_name", { name: me.birth_name })}
                </Txt>
              ) : null}
            </View>
            <Pressable
              testID="copy-soul-code"
              accessibilityRole="button"
              accessibilityLabel={`${tr("soul_app.life.soul_code")} ${spellSoulCode(me.soul_code)}`}
              accessibilityHint={tr("soul_app.life.copy_code")}
              onPress={copy}
              // The row is 16pt (the code's line). It used to be `hitSlop={12}`: 40 at best, and less
              // on Android, which routes a touch outside a parent only into its children's laid-out
              // boxes (TouchTargetHelper's overflow inset) — never into a slop — and this row is
              // the bottom of `bandText`. The 44pt target is the Pressable's own box instead:
              // padding grown, margins pulled back by the same, so nothing moves (`codeTarget*`).
              // Compact, mostly upward: the band clips (overflow hidden) 5pt under the code.
              style={[styles.code, small ? styles.codeTargetSmall : stack ? styles.codeTargetStack : styles.codeTarget]}
            >
              <Txt variant="value" style={[styles.codeText, { color: on }]}>
                {formatSoulCode(me.soul_code)}
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
function ResidenceNote({ me, landed }: { me: MeProfile; landed: boolean }) {
  const t = useTheme();
  const { t: tr, enumLabel } = useI18n();
  const { gutter } = useLayout();
  const civName = (civilization: string | null | undefined) => enumText(enumLabel("souls.civilizations", civilization), tr);
  return (
    <LandingWash on={landed} testID="residence-block">
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
    </LandingWash>
  );
}

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
  // The road is the HOME civilization's: Egypt and Europe have no 「轮回中」 step (review 2026-11-01).
  const at = lifePathIndex(me.current_state, planState, lex);
  const total = lifePath(lex).length;
  return (
    <View testID="life-now" style={[styles.now, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
      <StageMotif testID="stage-motif" civ={t.civ} color={t.ink} scheme={t.scheme} />
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
            {tr("soul_app.life.stage", { at: pad2(at + 1), total: pad2(total) })}
          </Txt>
          <LifePath at={at} lex={lex} />
        </>
      )}
    </View>
  );
}

/** How many walked places stay named above "here"; the rest fold into 「已走过 n 处」 (map.soul.behind). */
const ROUTE_BEHIND = 2;
/** How many places ahead are named; past that 「后面还有 n 处」 (map.soul.ahead). */
const ROUTE_AHEAD = 3;

/**
 * v4 「你现在在哪」 (V4Batch07 05 App, 灵魂端 · 本世; S12 soul.here.* · map.soul.*): the place in the serif at
 * 30/38, v4's sentence for it, then the road drawn top to bottom — walked in a solid line in the civilization's
 * colour, "here" in the metal with 「你现在在这里」, ahead dashed in --sub. Only the trunk (「支线不画」). A road
 * that ends (湮灭, 永罚) ends in `neg`. Nothing moves; there is nothing to still under reduce motion.
 */
function HereRoute({ route }: { route: SoulRoute }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  const from = Math.max(0, route.at - ROUTE_BEHIND);
  const to = Math.min(route.steps.length, route.at + 1 + ROUTE_AHEAD);
  const shown = route.steps.slice(from, to);
  const rest = route.steps.length - to;
  const here = route.steps[route.at];
  return (
    <View testID="life-now" style={[styles.here, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
      <Txt variant="label" style={[styles.hereEyebrow, { color: t.metal }]}>
        {tr("soul_app.life.here")}
      </Txt>
      <Txt testID="life-here-place" accessibilityRole="header" variant="display" style={{ fontFamily: titleFamily(route.place) }}>
        {route.place}
      </Txt>
      {route.line ? (
        <Txt testID="life-here-line" variant="bodyLg" style={styles.hereLine}>
          {route.line}
        </Txt>
      ) : null}
      <View testID="life-route" accessible accessibilityLabel={`${tr("map.soul.here")} · ${here.label}${here.sub ? ` · ${here.sub}` : ""}`} style={styles.route}>
        {from > 0 ? <RouteRow kind="walked" testID="route-behind" text={tr("map.soul.behind", { n: String(from) })} muted /> : null}
        {shown.map((step, i) => {
          const index = from + i;
          const kind = index < route.at ? "walked" : index === route.at ? "here" : "ahead";
          return <RouteRow key={step.id} kind={kind} step={step} last={index === route.steps.length - 1} testID={`route-${step.id}`} />;
        })}
        {rest > 0 ? <RouteRow kind="ahead" testID="route-ahead" text={tr("map.soul.ahead", { n: String(rest) })} muted last /> : null}
      </View>
    </View>
  );
}

function RouteRow({
  kind,
  step,
  text,
  muted,
  last,
  testID,
}: {
  kind: "walked" | "here" | "ahead";
  step?: RouteStep;
  text?: string;
  muted?: boolean;
  last?: boolean;
  testID: string;
}) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const end = step?.end;
  const mark = kind === "walked" ? t.plaque : kind === "here" ? (end ? t.neg : t.metal) : end ? t.neg : t.inkMuted;
  return (
    <View testID={testID} style={[styles.routeRow, kind === "here" && styles.routeRowHere]}>
      <View style={styles.routeRail}>
        {/* v4 dashes the road ahead; RN draws a dashed border only when all four sides are, so it is the hairline here. */}
        {last ? null : <View style={[styles.routeLine, { backgroundColor: kind === "walked" ? t.plaque : t.hair2 }]} />}
        <View
          testID={`${testID}-mark`}
          style={[
            styles.routeDot,
            kind === "here" ? [styles.routeDotHere, { borderColor: mark, backgroundColor: t.s0 }] : { borderColor: mark, backgroundColor: kind === "walked" ? mark : t.s0 },
          ]}
        />
      </View>
      <View style={styles.routeText}>
        {kind === "here" ? (
          <>
            <Txt variant="label" style={[styles.hereEyebrow, { color: end ? t.neg : t.metal }]}>
              {tr("map.soul.here")}
            </Txt>
            <Txt variant="title" style={{ fontFamily: titleFamily(step?.label ?? "") }}>
              {step?.label}
            </Txt>
            {step?.sub ? (
              <Txt variant="caption" tone="muted">
                {step.sub}
              </Txt>
            ) : null}
          </>
        ) : (
          <Txt variant={muted ? "caption" : "body"} tone={kind === "ahead" || muted ? "muted" : "ink"} style={end ? { color: t.neg } : undefined}>
            {text ?? step?.label}
          </Txt>
        )}
      </View>
    </View>
  );
}

/**
 * 「赴冥 · 十三站」(Design 第五十七批 S-2):本世五段条里「赴冥」那一段的放大,在路上时才画,走完(转世)就没有。
 * 同一种行程条(已过 ■ · 当前 ▪ · 未到 □),手机上只写当前站名,再一句这一站是什么地方(docs/06 §一)。
 */
function StationsCard({ station }: { station: string }) {
  const t = useTheme();
  const { t: tr, enumLabel } = useI18n();
  const { gutter } = useLayout();
  const at = diyuStationOrdinal(station);
  if (at === null) return null;
  const name = enumText(enumLabel("souls.diyu_station", station), tr);
  return (
    <View testID="life-stations" style={[styles.stations, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
      <View style={styles.stationsHead}>
        <SectionLabel style={styles.fill}>{tr("soul_app.life.stations_card")}</SectionLabel>
        <Txt testID="life-stations-at" variant="value" tone="muted" style={styles.small}>
          {`${at} / ${DIYU_STATIONS.length}`}
        </Txt>
      </View>
      <View testID="life-stations-strip" accessible accessibilityLabel={`${tr("soul_app.life.station_at", { n: String(at) })} · ${name}`} style={styles.stationsStrip}>
        {DIYU_STATIONS.map((s, i) => (
          <Txt key={s} style={[styles.stationGlyph, { color: i + 1 === at ? t.ink : t.inkMuted }]}>
            {i + 1 < at ? "■" : i + 1 === at ? "▪" : "□"}
          </Txt>
        ))}
      </View>
      <Txt testID="life-station-here" variant="body">
        {tr("soul_app.life.station_here", { station: name, desc: tr(`souls.diyu_station_desc.${station}`) })}
      </Txt>
    </View>
  );
}

/**
 * The balance: merit less demerit, the one number the page is for, in the title serif 28
 * (DESIGN.md 「展示数字 · 二档」, as the web soul page draws 功 / 过) on a v4 panel — s1, a
 * hairline, `radius.dialog` — in ink, never a status colour (a colour would make it a verdict).
 * The two sides the server sends beside it, in the soul's home lexicon (Egypt: feather side / heart side).
 */
function Balance({ me, lex }: { me: MeProfile; lex: CivKey }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  const { gutter } = useLayout();
  // 第三十批 零值: nothing entered either way is a sentence, not a display-size 0.
  const none = !me.merit_score && !me.demerit_score;
  const side = (word: "merit" | "demerit", value: number) => (
    <View testID={`score-${word}`} style={styles.side}>
      <Txt variant="caption" tone="subtle">
        {tr(lexiconKey(lex, word))}
      </Txt>
      <Txt variant="value">{grouped(value)}</Txt>
    </View>
  );
  return (
    <View style={[styles.balanceWrap, { paddingHorizontal: gutter, borderBottomColor: t.hair }]}>
      <View testID="balance" style={[styles.balance, { backgroundColor: t.s1, borderColor: t.hair }]}>
        <View style={styles.fill}>
          <Txt variant="caption" tone="subtle">
            {tr("soul_app.life.balance")}
          </Txt>
          {none ? (
            <Txt testID="balance-none" tone="muted">
              {tr("soul_app.life.balance_none")}
            </Txt>
          ) : (
            <Txt testID="balance-value" numberOfLines={1} adjustsFontSizeToFit style={[styles.balanceValue, { color: t.ink }]}>
              {signedBalance(me.merit_score, me.demerit_score)}
            </Txt>
          )}
        </View>
        {none ? null : side("merit", me.merit_score)}
        {none ? null : side("demerit", me.demerit_score)}
      </View>
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
 * How the five stage words fit their fifths of the row — one rule for the whole row, so the five
 * read at one size. A phrase may wrap, at its spaces, onto two lines; a single word keeps to one
 * line — given two it broke as 「Reincarnatin / g」 (华为真机 10-29). Width is settled by size, not
 * by `adjustsFontSizeToFit`: on Android that shrinks a word a little even when it fits, so
 * 「Alive」 came out smaller than the phrase 「My sentence」 beside it (华为真机 10-29 第二轮).
 * Instead the longest unbreakable token of the five decides one size for all five: 11pt while it is
 * at most STAGE_WORD_CHARS letters (what a fifth of a 360dp phone holds at 11pt), else scaled down
 * in proportion, never under 8pt. Chinese words are two or three characters and stay at 11pt.
 */
const STAGE_WORD_CHARS = 11;
export const stageWordFit = (words: string[]) => {
  const longest = Math.max(0, ...words.flatMap((w) => w.trim().split(/\s+/)).map((tok) => Array.from(tok).length));
  const fontSize = longest <= STAGE_WORD_CHARS ? 11 : Math.max(8, Math.floor((22 * STAGE_WORD_CHARS) / longest) / 2);
  const size = { fontSize, lineHeight: Math.ceil(fontSize * 1.45) };
  return (word: string) => ({ numberOfLines: /\s/.test(word.trim()) ? 2 : 1, size });
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
  const path = lifePath(lex);
  const span = 100 / path.length;
  const fit = stageWordFit(path.map(word));
  return (
    <View testID="life-path" accessible accessibilityLabel={`${tr("souls.detail.ledger.route_title")} · ${word(path[at])}`} style={styles.path}>
      {path.slice(1).map((step, i) => (
        <View
          key={step}
          testID={`path-seg-${i}`}
          style={[styles.segment, { left: `${span * (i + 0.5)}%`, width: `${span}%`, backgroundColor: i < at ? t.ink : t.hair }]}
        />
      ))}
      {path.map((step, i) => {
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
                <Txt style={[styles.stageMark, where === "done" && styles.stageGlyph, { color: where === "ahead" ? t.inkMuted : t.s0 }]}>{where === "done" ? "✓" : String(i + 1)}</Txt>
              </View>
            </View>
            <Txt
              testID={`path-${step}-word`}
              numberOfLines={fit(word(step)).numberOfLines}
              style={[styles.stageWord, fit(word(step)).size, { color: where === "here" ? t.ink : t.inkMuted, fontFamily: family.ui[where === "here" ? 600 : 400] }]}
            >
              {word(step)}
            </Txt>
          </View>
        );
      })}
    </View>
  );
}

/** v3 「问一问」: a 48pt circle, solid ink as the primary button (第四十八批第三节 A5; it was the civilization's colour), over its foot. */
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
      style={({ pressed }) => [styles.ask, { backgroundColor: pressed ? shade(t.ink) : t.ink }]}
    >
      <AskGlyph color={t.s0} />
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

/**
 * 第六十二批:推送「已超度」打开本世页,滚到「已超度」那一行(或并进了日期的枉死城那一行),然后不再动 ——
 * 不闪、不洗底色;减弱动效时不做平滑滚动。每次落地只滚一次。
 */
function useScrollToDelivered(scrollRef: RefObject<ScrollView | null>, focus: LifeFocus | undefined) {
  const reduced = useReducedMotion();
  const [target, hold] = useState<View | null>(null);
  const done = useRef<LifeFocus | undefined>(undefined);
  useEffect(() => {
    if (!focus?.delivered || !target || done.current === focus) return;
    const scroller = scrollRef.current;
    // `getInnerViewRef` is in the runtime (ScrollView.js) but not in the .d.ts (same as passwordRulesView).
    const inner = (scroller as { getInnerViewRef?: () => unknown } | null)?.getInnerViewRef?.();
    if (!scroller || !inner) return;
    done.current = focus;
    target.measureLayout(
      inner as never,
      (_x, y) => scroller.scrollTo({ y: Math.max(0, y - 16), animated: !reduced }),
      () => {}
    );
  }, [focus, target, reduced, scrollRef]);
  return { hold };
}

export function MyLifeScreen() {
  const { t, locale, enumLabel } = useI18n();
  const { state, refreshProfile } = useSession();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  // A sentence push landed here (受刑 1d): highlighted until the page is left, then forgotten —
  // the param is the whole record, nothing is stored. A judgment / disposition / residence push (第四十批 S-e)
  // names the row to wash; forgotten the same way.
  const params = useRoute<RouteProp<{ Life: LifeParams }, "Life">>().params;
  const landing = params?.sentenceLanding;
  const focus = params?.lifeFocus;
  useFocusEffect(
    useCallback(() => {
      if (!landing && !focus) return;
      return () => (navigation.setParams as (p: LifeParams) => void)({ sentenceLanding: undefined, lifeFocus: undefined });
    }, [landing, focus, navigation])
  );
  const life = useRemote(soulApi.life);
  // 第五十二批:申诉行。失败就不画(审判卡片照旧),下次回到这页再取。
  const appeals = useRemote(soulApi.judgmentAppeals);
  // 枉死城申诉行:同上,失败就不画。枉死城只在地府:别的文明不请求 /me/wangsi/。
  const diyu = state.status === "signedIn" && state.profile.civilization === "CHINESE";
  const fetchWangsi = useCallback(() => (diyu ? soulApi.wangsi() : Promise.resolve<MeWangsiCase[]>([])), [diyu]);
  const wangsi = useRemote(fetchWangsi);
  const residence = useResidence();
  const toast = useToast();
  useReloadOnRefocus(life.reload, life);
  useReloadOnRefocus(appeals.reload, appeals);
  useReloadOnRefocus(wangsi.reload, wangsi);
  // 页头(阳寿、状态、所在)读的是会话里的档案:别的页改了它(审判结案、转世),回到这页也要重取。
  // 回到前台的重取失败不吵(下次再取);下拉刷新失败要说(见 `refresh`)。
  const reloadProfile = useCallback(() => refreshProfile().catch(() => {}), [refreshProfile]);
  useReloadOnRefocus(reloadProfile);
  const [refreshes, setRefreshes] = useState(0);
  const sentence = useSentencePlan({ landing, reloadKey: refreshes });
  const scroll = useScrollToLanding(landing);
  const delivered = useScrollToDelivered(scroll.ref, focus);
  const soulCode = state.status === "signedIn" ? state.profile.soul_code : "";
  const memo = `${LIFE_OPEN_PREFIX}${soulCode}`;
  const [touched, setTouched] = useState(() => readTouched(memo));
  const [compact, setCompact] = useState(false);
  const theme = useTheme();
  const { gutter } = useLayout();
  const hall = useCurrentHall();
  const [now] = useState(() => Date.now());
  // v4 「你现在在哪」 and the lock screen's live progress read the same place (soulRoute.ts).
  const route =
    state.status === "signedIn" ? soulRoute({ me: state.profile, civ: residence.home, plan: sentence.data, hall, now }, t) : null;
  useLiveProgress(route, state.status === "signedIn" ? state.profile.name : "");
  if (state.status !== "signedIn") return null;
  const me = state.profile;
  const planState = sentence.data?.state;
  // The section a push points into is open, whatever was last left folded.
  const open = {
    ...lifeSectionsOpen(touched, planState),
    ...(focus?.judgment ? { judgments: true } : {}),
    ...(focus?.disposition ? { dispositions: true } : {}),
    ...(focus?.delivered ? { judgments: true } : {}),
    ...(focus?.appeals ? { judgments: true } : {}),
  };
  // 第六十二批 D-1:超度若已写在这一世枉死城那一行(审判那格底部,带日期),顶上就不另画「已超度」。
  // 两份数据都回来(或失败)之后才判断,免得先画后收。
  const deliveredInLine = wangsi.data?.some(
    (w) => w.grievance_status === "DELIVERED" && life.data?.judgments.some((j) => j.id === w.judgment_id)
  );
  const settled = (life.data || life.error) && (wangsi.data || wangsi.error);
  const toggle = (key: LifeSectionKey) => {
    const next = { ...touched, [key]: !open[key] };
    setTouched(next);
    platform().persistent.set(memo, JSON.stringify(next));
  };
  const unrecorded = t("common.value.unrecorded");
  const stations = me.civilization === "CHINESE" && !!me.diyu_station;
  const deliveredRow = !!(settled && !deliveredInLine && me.wangsi_delivered_at);
  // 第六十四批:十三站卡、枉死城那一行、已超度行,任一出现就算「上路了」—— 已交城隍的勾魂牒收成资料行里一行。
  // 不按站名判断(站名单会变)。
  const onTheRoad = stations || deliveredRow || !!wangsi.data?.length;

  const refresh = () => {
    void life.reload();
    void appeals.reload();
    void wangsi.reload();
    setRefreshes((n) => n + 1);
    refreshProfile().catch((e: unknown) => {
      const m = soulErrorMessage(e);
      toast(t(m.key, m.params), "failure");
    });
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
        <ContactEmailNudge />
        {residence.residing ? <ResidenceNote me={me} landed={!!focus?.residence} /> : null}
        {/* v4: where the data places the soul on its road, the place and the road; otherwise the state and the five stages. */}
        {route ? <HereRoute route={route} /> : <Now me={me} lex={residence.home} planState={planState} />}
        {/* 第六十二批:位置类的卡在五段条正下方,固定顺序 勾魂牒 → 已超度 → 十三站 → 冥河 → 前庭(不按时间)。 */}
        {onTheRoad && me.capture_warrant?.status === "HANDED_OVER" ? null : <CaptureCard warrant={me.capture_warrant} />}
        {deliveredRow ? <DeliveredRow at={me.wangsi_delivered_at} holdRef={delivered.hold} /> : null}
        {/* The thirteen stations are the road above once it is drawn (地府 always has one when it has a station). */}
        {stations && !route ? <StationsCard station={me.diyu_station} /> : null}
        <FerryCard ferry={me.greek_ferry} />
        <VestibuleCard vestibule={me.european_vestibule} />
        <Balance me={me} lex={residence.home} />
        <Block>
          {/* 第三十批: 本世 is a 「卷」 — the serif at 16/28, hairline rules, the field names a column of their own. */}
          <DataRows juan>
            <DataRow label={t("soul_app.life.birth")} mono>
              {formatHistoricalDate(me.birth_date, locale) ?? unrecorded}
            </DataRow>
            <DataRow label={t("soul_app.life.death")} mono>
              {formatHistoricalDate(me.death_date, locale) ?? unrecorded}
            </DataRow>
            <DataRow label={t("soul_app.life.origin")}>{me.origin_location || unrecorded}</DataRow>
            {/* 地府:出身部洲(docs/07)不详也画,别的文明不画。十三站是「你现在在哪」下面的卡片(StationsCard)。 */}
            {me.civilization === "CHINESE" ? (
              <DataRow label={t("soul_app.life.continent")} testID="life-continent">
                {me.birth_continent ? enumText(enumLabel("souls.birth_continent", me.birth_continent), t) : unrecorded}
              </DataRow>
            ) : null}
            {onTheRoad ? <CaptureLine warrant={me.capture_warrant} /> : null}
          </DataRows>
        </Block>
        {/* v3 .life-records: 「本世账目」 and its six numbered rows. */}
        <View testID="ledger-head" style={[styles.ledgerHead, { paddingHorizontal: gutter, backgroundColor: theme.s1, borderBottomColor: theme.hair }]}>
          <SectionLabel style={styles.fill}>{t("soul_app.life.ledger")}</SectionLabel>
          <Txt variant="caption" tone="subtle">
            {t("soul_app.life.ledger_hint")}
          </Txt>
        </View>
        <AppealDeadlineNote list={appeals.data} onOpen={() => {
            if (!open.judgments) toggle("judgments");
          }}
        />
        {life.data ? (
          <FadeIn onLayout={(e) => scroll.place("sections", e.nativeEvent.layout.y)}>
            <LifeSections
              life={life.data}
              lex={residence.home}
              greekAccount={sentence.data?.greek_account}
              numbered
              focus={focus}
              appeals={appeals}
              wangsi={wangsi.data}
              deliveredRef={delivered.hold}
              confession={<ConfessionCard tally={me.negative_confession} />}
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
  gone: { opacity: 0.45 },
  fill: { flex: 1 },
  shrink: { flexShrink: 1 },
  pressed: { opacity: 0.8 },
  link: { textDecorationLine: "underline" },
  noSpacing: { letterSpacing: 0 },
  rule: { marginVertical: 16 },
  record: { paddingVertical: 12, gap: 4 },
  verdictSeal: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 8 },
  recordHead: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  kind: { width: 20, height: 18, alignItems: "flex-start", justifyContent: "center" },
  milestone: { borderWidth: 1, paddingHorizontal: 4, paddingVertical: 2 },
  milestoneText: { fontSize: 11, lineHeight: 14 },
  milestoneLine: { flexDirection: "row" },
  recordDate: { fontSize: 11, opacity: 0.8 },
  basisLine: { flexDirection: "row", flexWrap: "wrap", columnGap: 12 },
  apps: { gap: 12 },
  appCard: { flexDirection: "row", alignItems: "center", gap: 12, borderWidth: 1, padding: 16 },
  appSummary: { gap: 8 },
  /** v3 .life-identity: 116pt (meta line, seal row) → 48pt (one row) on scroll. */
  band: { overflow: "hidden", paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 12 },
  bandSmall: { paddingVertical: 0, paddingLeft: 12, paddingRight: 4, justifyContent: "center" },
  bandMeta: { fontFamily: family.mono[400], fontSize: 11, lineHeight: 16, letterSpacing: 0.6 },
  bandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  bandText: { flex: 1, minWidth: 0, gap: 4 },
  // Sized to its words (not stretched), so its width is where the name ends: the head mark's clearance reads it.
  nameRow: { flexDirection: "row", alignItems: "baseline", columnGap: 8, alignSelf: "flex-start", maxWidth: "100%" },
  bandFrame: { overflow: "hidden" },
  // The soul's name: the title serif (Noto Serif SC 600) via `titleFamily(me.name)`, v4's big title 30/38
  // (the text column, 38 + 4 + the code's 16, still fits beside the 64pt seal).
  name: { fontSize: 30, lineHeight: 38, flexShrink: 1 },
  nameSmall: { fontSize: 13, lineHeight: 18, flexShrink: 1 },
  code: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" },
  /** 16 + 14 + 14 = 44. Full, the band has room below the row for the even split. */
  codeTarget: { paddingVertical: CODE_REACH / 2, marginVertical: -CODE_REACH / 2 },
  /** 16 + 23 + 5 = 44, kept inside the 48pt compact band (its code row ends 5pt above the edge). */
  codeTargetSmall: { paddingTop: CODE_REACH - CODE_FOOT_SMALL, paddingBottom: CODE_FOOT_SMALL, marginTop: -(CODE_REACH - CODE_FOOT_SMALL), marginBottom: -CODE_FOOT_SMALL },
  /** Stacked the line is 16 × the text scale (≥ 27pt) and the band has no fixed height: no negative margins to push the box past the clipped edge, just a 44pt floor. */
  codeTargetStack: { minHeight: 44 },
  codeText: { fontSize: 11, lineHeight: CODE_LINE, letterSpacing: 1.6, fontFamily: family.mono[500] },
  account: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  /** v3 .life-now. */
  now: { paddingTop: 24, paddingBottom: 24, alignItems: "center", gap: 8, borderBottomWidth: 1, overflow: "hidden" },
  /** v3 .life-current: the glyph over the word, both 56; the word in the title serif (Noto Serif SC 600). One line, shrinking to fit (a long English state). */
  nowState: { alignSelf: "stretch", alignItems: "center", marginTop: 8 },
  nowGlyph: { fontSize: 56, lineHeight: 64 },
  nowWord: { fontFamily: family.title, fontSize: 56, lineHeight: 64, textAlign: "center" },
  small: { fontSize: 11, lineHeight: 16 },
  /** v4 「你现在在哪」: 12 / 600 in the metal, the place at 30/38, its sentence 15/24, then the road. */
  here: { paddingTop: 24, paddingBottom: 24, borderBottomWidth: 1 },
  hereEyebrow: { fontFamily: family.ui[600], letterSpacing: 0 },
  // v4 draws 6 and 22; the App's spacing scale (补足 A2) has 8 and 24.
  hereLine: { marginTop: 8, fontFamily: family.ui[400] },
  route: { marginTop: 24 },
  /** A 28 rail (the line at its centre, 2.5 wide) and the words 12 beside it; a row is 48, "here" 96. */
  routeRow: { flexDirection: "row", gap: 12, minHeight: 48 },
  routeRowHere: { minHeight: 96 },
  routeRail: { width: 28, alignItems: "center" },
  routeLine: { position: "absolute", top: 18, bottom: -4, left: 12.75, width: 2.5, borderRadius: 2 },
  // 8 + 7 = 15, the middle of the words' first line (4 + 22 / 2).
  routeDot: { marginTop: 8, width: 14, height: 14, borderRadius: 999, borderWidth: 2 },
  routeDotHere: { marginTop: 2, width: 24, height: 24, borderWidth: 4 },
  routeText: { flex: 1, minWidth: 0, paddingTop: 4 },
  stations: { paddingTop: 16, paddingBottom: 16, gap: 12, borderBottomWidth: 1 },
  stationsHead: { flexDirection: "row", alignItems: "center", gap: 12 },
  stationsStrip: { flexDirection: "row", justifyContent: "space-between" },
  stationGlyph: { fontFamily: family.glyph, fontSize: 13, lineHeight: 18 },
  path: { alignSelf: "stretch", flexDirection: "row", marginTop: 16 },
  /** The line behind the circles, centre to centre: walked in ink, ahead in the hairline. */
  segment: { position: "absolute", top: 14, height: 2 },
  stage: { flex: 1, alignItems: "center", gap: 8 },
  stageRing: { width: 30, height: 30, borderRadius: 999, borderWidth: 1, borderColor: "transparent", alignItems: "center", justifyContent: "center" },
  stageDot: { width: 30, height: 30, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stageHere: { width: 28, height: 28, borderWidth: 4 },
  stageMark: { fontFamily: family.mono[400], fontSize: 11, lineHeight: 14 },
  /** ✓ from the status-glyph face: the mono face (Plex then, Geist Mono now) has none, so the OS fell back to a √-like mark. */
  stageGlyph: { fontFamily: family.glyph },
  stageWord: { fontSize: 11, lineHeight: 16, textAlign: "center" },
  /** The balance panel (as applications' A11 panel): s1, a hairline, `radius.dialog`, 16 inside; the number title 28 / 36. */
  balanceWrap: { paddingTop: 16, paddingBottom: 16, borderBottomWidth: 1 },
  balance: { flexDirection: "row", alignItems: "center", gap: 24, borderWidth: 1, borderRadius: radius.dialog, padding: 16 },
  side: { alignItems: "flex-start", gap: 4 },
  balanceValue: { marginTop: 4, fontFamily: family.title, fontSize: 28, lineHeight: 36 },
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
