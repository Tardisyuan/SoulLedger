import {
  DESIRED_REBIRTH_FORMS,
  rejectionReasonOf,
  soulApi,
  soulCodeMessage,
  soulErrorMessage,
  type DesiredRebirthForm,
  type MeRebirthApplication,
  type MeRebirthApplicationList,
  type SoulErrorMessage,
} from "@soulledger/core/api/soul";
import { useNavigation, type NavigationProp } from "@react-navigation/native";
import { useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";

import { Emblem, Icon } from "../emblems";
import { useToast } from "../feedback";
import { useI18n } from "../i18n";
import { APPLICATION_BADGES, buildFlow, formatStamp, lexiconKey, wasAppealed, type FlowStep } from "../rules";
import { SessionContext } from "../session";
import {
  Block,
  Button,
  DataRow,
  DataRows,
  Empty,
  EnumBadge,
  EnumValue,
  FadeIn,
  GUTTER,
  Input,
  Interp,
  Notice,
  Quote,
  Screen,
  ScreenError,
  Skeleton,
  Txt,
  enumText,
  useReloadOnRefocus,
  useReducedMotion,
  useRemote,
  useLayout,
  useTheme,
} from "../ui";
import { useResidence } from "./life";

export type AppStackParams = {
  /**
   * `screen` picks the tab (a push landing on the life tab). The circle's
   * `pendingId`: the post just sent went to review — the feed says so over it.
   */
  Tabs: { screen: "Life" | "Applications" | "Letters" | "Circle"; params?: { pendingId?: string } } | undefined;
  NewApplication: undefined;
  /** `landed`: opened from a tapped notification — the result block is highlighted once. */
  ApplicationDetail: { id: string; landed?: boolean };
  Settings: undefined;
  NotificationPrimer: undefined;
  /** `landed`: opened from a tapped notification — the newest letter from the other side is highlighted once. */
  Conversation: { id: string; landed?: boolean };
  FindSoul: undefined;
  ComposePost: undefined;
  CirclePost: { id: string };
  SoulProfile: { userId: number };
  MyCircle: undefined;
  CircleFollows: { relation: "following" | "followers" };
  CircleSearch: undefined;
  /** `preview`: the post / comment text, or the soul's name — shown so the reporter sees what they report. */
  CircleReport: { target: "POST" | "COMMENT" | "USER"; id: string; preview: string };
};

/**
 * The server's `terminal_cosmology`: this soul's (home) civilization has no
 * rebirth. The entry stays — permanently disabled, with the fixed reason — and
 * the empty list says why it will stay empty (handoff 2a/2f).
 */
export const TERMINAL_REASON = "terminal_cosmology";

function TerminalEmpty() {
  const theme = useTheme();
  const { t } = useI18n();
  const { home } = useResidence();
  return (
    <View testID="terminal-empty" style={styles.terminal}>
      <Emblem civ={home} size={24} stroke={theme.hair2} strokeWidth={2} />
      <Txt variant="nav" style={styles.center}>
        {t(lexiconKey(home, "no_rebirth_title"))}
      </Txt>
      <Txt variant="caption" tone="subtle" style={styles.center}>
        {t(lexiconKey(home, "no_rebirth_body"))}
      </Txt>
    </View>
  );
}

/**
 * Whether the "apply" entry is offered. The server decides (`can_apply`), and
 * a refusal is always explained under the disabled button — the reason code,
 * and the cooling-off end date when there is one.
 */
export function EligibilityCard({ list, onApply }: { list: MeRebirthApplicationList; onApply: () => void }) {
  const { t } = useI18n();
  const reason = list.reason ? soulCodeMessage(list.reason) : null;
  const until = formatStamp(list.cooldown_until);
  return (
    <Block testID="eligibility">
      <Button
        testID="apply"
        title={t("soul_app.applications.new")}
        onPress={onApply}
        disabled={!list.can_apply}
        reasonTestID="eligibility-reason"
        reason={reason ? t(reason.key, reason.params) : t("soul_app.applications.cannot_apply")}
      />
      {!list.can_apply && until ? (
        <Interp
          testID="cooldown-until"
          variant="caption"
          tone="muted"
          style={styles.cooldown}
          text={t("soul_app.applications.cooldown_until")}
          parts={{ date: <Txt variant="value" tone="muted">{until}</Txt> }}
        />
      ) : null}
    </Block>
  );
}

function ApplicationRow({ a, onOpen }: { a: MeRebirthApplication; onOpen: () => void }) {
  const theme = useTheme();
  const { gutter } = useLayout();
  return (
    <Pressable
      testID={`open-${a.id}`}
      accessibilityRole="button"
      onPress={onOpen}
      style={({ pressed }) => [styles.appRow, { paddingHorizontal: gutter, borderBottomColor: theme.hair }, pressed && styles.pressed]}
    >
      <View style={styles.fill}>
        <EnumBadge namespace="soul_app.status" table={APPLICATION_BADGES} value={a.status} />
        <View style={styles.gap10}>
          <EnumValue namespace="reincarnation.forms" value={a.desired_form} tone="ink" variant="bodyLg" />
        </View>
        <Txt variant="value" tone="subtle" style={styles.gap4}>
          {formatStamp(a.created_at)}
        </Txt>
      </View>
      <Icon name="chevron" size={15} color={theme.inkSubtle} />
    </Pressable>
  );
}

/**
 * Handoff 3b: a residing soul's applications are still its home civilization's
 * to decide — said once, at the top of the tab, in the current skin.
 */
function useResidenceNames(): { current: string; home: string } | null {
  const { t, enumLabel } = useI18n();
  const { residing } = useResidence();
  const session = useContext(SessionContext);
  const me = session?.state.status === "signedIn" ? session.state.profile : null;
  if (!me || !residing) return null;
  const civName = (c: string) => enumText(enumLabel("souls.civilizations", c), t);
  return { current: civName(me.civilization), home: civName(me.home_civilization) };
}

function ResidenceNote() {
  const theme = useTheme();
  const { t } = useI18n();
  const { gutter } = useLayout();
  const names = useResidenceNames();
  if (!names) return null;
  return (
    <View testID="residence-applications" style={[styles.residenceNote, { paddingHorizontal: gutter, borderBottomColor: theme.hair, backgroundColor: theme.s1 }]}>
      <View style={styles.nudge}>
        <Icon name="info" size={14} color={theme.inkSubtle} strokeWidth={1.2} />
      </View>
      <Txt variant="caption" tone="muted" style={styles.fill}>
        {t("soul_app.applications.residing_note", names)}
      </Txt>
    </View>
  );
}

export function ApplicationsScreen() {
  const { t } = useI18n();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const list = useRemote(soulApi.applications);
  useReloadOnRefocus(list.reload);
  if (list.error && !list.data) {
    return (
      <Screen scroll={false} edges={["left", "right"]}>
        <ScreenError error={soulErrorMessage(list.error)} onRetry={list.reload} />
      </Screen>
    );
  }
  return (
    <Screen refreshing={list.loading && !!list.data} onRefresh={list.reload} edges={["left", "right"]}>
      {!list.data ? (
        <Block>
          <Skeleton lines={3} />
        </Block>
      ) : (
        <FadeIn>
          <ResidenceNote />
          <EligibilityCard list={list.data} onApply={() => navigation.navigate("NewApplication")} />
          {list.data.results.length === 0 ? (
            list.data.reason === TERMINAL_REASON ? (
              <TerminalEmpty />
            ) : (
              <Empty text={t("soul_app.applications.empty")} />
            )
          ) : null}
          {list.data.results.map((a) => (
            <ApplicationRow key={a.id} a={a} onOpen={() => navigation.navigate("ApplicationDetail", { id: a.id })} />
          ))}
        </FadeIn>
      )}
    </Screen>
  );
}

function FormCard({ form, selected, onPick }: { form: DesiredRebirthForm; selected: boolean; onPick: () => void }) {
  const theme = useTheme();
  const { t } = useI18n();
  const { compact } = useLayout();
  return (
    <Pressable
      testID={`form-${form}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={onPick}
      style={({ pressed }) => [
        styles.formCard,
        { backgroundColor: theme.s0, borderLeftColor: selected ? theme.mark : "transparent" },
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.dot, { borderColor: selected ? theme.mark : theme.hair2 }]}>
        {selected ? <View style={[styles.dotFill, { backgroundColor: theme.mark }]} /> : null}
      </View>
      <View style={styles.fill}>
        {/* 320pt: the enum member moves under the name (handoff 2c). */}
        <View style={compact ? undefined : styles.formName}>
          <Txt variant="bodyLg">{t(`reincarnation.forms.${form}`)}</Txt>
          <Txt variant="value" tone="subtle" style={styles.formCode}>
            {form}
          </Txt>
        </View>
        <Txt variant="caption" tone="subtle">
          {t(`soul_app.form_notes.${form}`)}
        </Txt>
      </View>
    </Pressable>
  );
}

export function NewApplicationScreen() {
  const theme = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const navigation = useNavigation<NavigationProp<AppStackParams>>();
  const [form, setForm] = useState<DesiredRebirthForm | null>(null);
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SoulErrorMessage | null>(null);

  const submit = async () => {
    if (!form) return setError({ key: "soul_app.applications.choose_form" });
    setBusy(true);
    setError(null);
    try {
      const created = await soulApi.submitApplication(form, statement);
      toast(t("soul_app.applications.submitted"));
      navigation.goBack();
      navigation.navigate("ApplicationDetail", { id: created.id });
    } catch (e) {
      setError(soulErrorMessage(e));
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Block last style={styles.stack}>
        <View style={[styles.note, { borderLeftColor: theme.hair2 }]}>
          <Interp
            variant="caption"
            tone="muted"
            text={t("soul_app.applications.expectation")}
            parts={{ hope: <Txt variant="caption">{t("soul_app.applications.expectation_word")}</Txt> }}
          />
        </View>
        <View>
          <Txt variant="section" style={styles.heading}>
            {t("soul_app.applications.desired_form")}
          </Txt>
          <View accessibilityRole="radiogroup" style={[styles.forms, { backgroundColor: theme.hair }]}>
            {DESIRED_REBIRTH_FORMS.map((f) => (
              <FormCard key={f} form={f} selected={form === f} onPick={() => setForm(f)} />
            ))}
          </View>
        </View>
        <View style={styles.statement}>
          <Input
            testID="statement"
            label={t("soul_app.applications.statement")}
            hint={t("soul_app.applications.statement_hint")}
            value={statement}
            onChangeText={setStatement}
            multiline
            maxLength={2000}
          />
        </View>
        {error ? (
          <Notice tone="neg" testID="new-application-error">
            {t(error.key, error.params)}
          </Notice>
        ) : null}
        <Button
          testID="submit-application"
          title={t(busy ? "soul_app.applications.submitting" : "soul_app.applications.submit")}
          onPress={submit}
          busy={busy}
          disabled={!form}
          reason={t("soul_app.applications.choose_form")}
          reasonTestID="submit-application-reason"
        />
        <Button kind="secondary" title={t("soul_app.common.cancel")} onPress={() => navigation.goBack()} />
      </Block>
    </Screen>
  );
}

/**
 * The flow (handoff 2e): done = solid mark with its time; now = hollow accent,
 * no time; todo = 1px empty box. The rail joins what has happened; after the
 * current step it is dashed, because how many steps follow is unknown. At
 * large text the rail goes and the boxes grow to 16.
 */
/** A namespace, not a key: messages.test harvests quoted `soul_app.*` literals as keys, and covers this namespace separately. */
const STATUS_NAMESPACE = ["soul_app", "status"].join(".");

function Flow({ steps }: { steps: FlowStep[] }) {
  const theme = useTheme();
  const { t, enumLabel } = useI18n();
  const { stack } = useLayout();
  return (
    <View testID="timeline">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const dot =
          step.state === "done"
            ? { backgroundColor: theme.mark, borderColor: theme.mark, borderWidth: 1 }
            : step.state === "now"
              ? { backgroundColor: theme.s0, borderColor: theme.accent, borderWidth: 2 }
              : { backgroundColor: "transparent", borderColor: theme.hair2, borderWidth: 1 };
        const name = step.name.status
          ? t(step.name.key, { status: enumText(enumLabel(STATUS_NAMESPACE, step.name.status), t) })
          : t(step.name.key);
        const sub = [step.role ? enumText(enumLabel("users.roles", step.role), t) : null, step.note ? t(step.note) : null]
          .filter(Boolean)
          .join(" · ");
        return (
          <View key={step.key} testID={`step-${step.key}`} style={styles.step}>
            <View style={[styles.rail, stack && styles.railStacked]}>
              <View testID={`step-${step.key}-${step.state}`} style={[stack ? styles.stepDotLarge : styles.stepDot, dot]} />
              {last || stack ? null : (
                <View
                  testID={step.dashedAfter ? `step-${step.key}-dashed` : undefined}
                  style={
                    step.dashedAfter
                      ? [styles.stepLineDashed, { borderColor: theme.hair2 }]
                      : [styles.stepLine, { backgroundColor: theme.hair }]
                  }
                />
              )}
            </View>
            <View style={[styles.fill, !last && styles.stepGap]}>
              <Txt variant="bodyLg" tone={step.state === "todo" ? "subtle" : "ink"} style={styles.stepName}>
                {name}
              </Txt>
              {step.at ? (
                <Txt variant="value" tone="subtle" style={styles.stepWhen}>
                  {formatStamp(step.at)}
                </Txt>
              ) : null}
              {sub ? (
                <Txt variant="caption" tone="subtle" style={styles.stepWhen}>
                  {sub}
                </Txt>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Handoff 3c: the block a tapped notification points at — a 3px mark rule on
 * the left, the surface one step up, a "新结果" tag top right. After 1.2s the
 * surface and the tag fade; the rule stays, so the landing is still findable.
 * Under reduce-motion nothing moves: only the rule is drawn.
 */
function LandingHighlight({ on, children }: { on: boolean; children: ReactNode }) {
  const theme = useTheme();
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const [opacity] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!on || reduced) return;
    const timer = setTimeout(() => Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(), 1200);
    return () => clearTimeout(timer);
  }, [on, opacity, reduced]);
  if (!on) return <>{children}</>;
  return (
    <View testID="landing-highlight">
      {reduced ? null : <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity, backgroundColor: theme.s1 }]} />}
      {children}
      <View testID="landing-rule" pointerEvents="none" style={[styles.landingRule, { backgroundColor: theme.mark }]} />
      {reduced ? null : (
        <Animated.View pointerEvents="none" style={[styles.landingTag, { borderColor: theme.accent, opacity }]}>
          <Txt testID="landing-tag" variant="label" tone="accent" style={styles.landingTagText}>
            {t("soul_app.detail.new_result")}
          </Txt>
        </Animated.View>
      )}
    </View>
  );
}

export function ApplicationDetailScreen({ id, landed }: { id: string; landed?: boolean }) {
  const theme = useTheme();
  const { t } = useI18n();
  const toast = useToast();
  const fetcher = useCallback(() => soulApi.application(id), [id]);
  const app = useRemote(fetcher);
  const residence = useResidenceNames();
  const [appeal, setAppeal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SoulErrorMessage | null>(null);

  if (app.error && !app.data) {
    return (
      <Screen scroll={false}>
        <ScreenError error={soulErrorMessage(app.error)} onRetry={app.reload} />
      </Screen>
    );
  }
  if (!app.data) {
    return (
      <Screen>
        <Block>
          <Skeleton lines={5} />
        </Block>
      </Screen>
    );
  }
  const a = app.data;
  const reason = rejectionReasonOf(a);
  const appealed = wasAppealed(a);
  const unrecorded = t("soul_app.detail.not_recorded");

  const submitAppeal = async () => {
    setBusy(true);
    setError(null);
    try {
      await soulApi.appeal(a.id, appeal);
      setAppeal("");
      toast(t("soul_app.detail.appealed"));
      await app.reload();
    } catch (e) {
      setError(soulErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen refreshing={app.loading} onRefresh={app.reload}>
      <FadeIn>
        <LandingHighlight on={!!landed}>
        <Block testID="application-detail">
          {/* Items here do not shrink: they wrap as whole pills. ("↺" over "申诉中" on iOS
              was the pill's own flexWrap, not shrinking — see Badge in ui.tsx.) */}
          <View style={styles.badgeRow}>
            <View testID="status-badge-slot" style={styles.badgeItem}>
              <EnumBadge testID="status-badge" namespace="soul_app.status" table={APPLICATION_BADGES} value={a.status} />
            </View>
            {residence ? (
              <View style={[styles.handler, styles.badgeItem, { borderColor: theme.hair2 }]}>
                <Txt testID="handled-by" variant="label" tone="muted" style={styles.handlerText}>
                  {t("soul_app.detail.handled_by", { home: residence.home })}
                </Txt>
              </View>
            ) : null}
          </View>
          <View style={styles.formTitle}>
            <EnumValue namespace="reincarnation.forms" value={a.desired_form} tone="ink" variant="display" />
          </View>
          <DataRows style={styles.facts}>
            <DataRow label={t("soul_app.detail.created_at")} mono>
              {formatStamp(a.created_at) ?? t("common.value.unrecorded")}
            </DataRow>
            {a.decided_at ? (
              <DataRow label={t("soul_app.detail.decided_at")} mono>
                {formatStamp(a.decided_at) ?? t("common.value.unrecorded")}
              </DataRow>
            ) : null}
            {a.current_step ? (
              <>
                <DataRow label={t("soul_app.detail.current_step")}>
                  <EnumValue namespace="workflow.node_type" value={a.current_step.node_type} />
                </DataRow>
                <DataRow label={t("soul_app.detail.approver_role")}>
                  <EnumValue namespace="users.roles" value={a.current_step.approver_role} />
                </DataRow>
              </>
            ) : null}
            <DataRow label={t("soul_app.detail.cross_civilization")}>
              {a.cross_civilization === null || a.cross_civilization === undefined
                ? t("soul_app.detail.cross_undecided")
                : t(a.cross_civilization ? "soul_app.detail.cross_yes" : "soul_app.detail.cross_no")}
            </DataRow>
          </DataRows>
        </Block>
        </LandingHighlight>

        <Block>
          <Txt variant="section" style={styles.heading}>
            {t("soul_app.detail.flow")}
          </Txt>
          <Flow steps={buildFlow(a)} />
        </Block>

        {a.statement ? (
          <Block>
            <Txt variant="section" style={styles.headingTight}>
              {t("soul_app.detail.statement")}
            </Txt>
            <Quote text={a.statement} />
          </Block>
        ) : null}

        {/* The first rejection survives an appeal (first_rejection_reason / first_decided_at);
            applications appealed before those columns existed say "unrecorded", not nothing. */}
        {appealed ? (
          <Block style={{ backgroundColor: theme.s1 }} testID="first-rejection">
            <View style={styles.headingRow}>
              <Txt variant="section">{t("soul_app.detail.first_rejection_reason")}</Txt>
              <Txt testID="first-rejection-at" variant="value" tone="subtle" style={styles.meta}>
                {formatStamp(a.first_decided_at) ?? unrecorded}
              </Txt>
            </View>
            {a.first_rejection_reason ? (
              <Quote testID="first-rejection-reason" text={a.first_rejection_reason} tone="rejection" />
            ) : (
              <Txt testID="first-rejection-reason" variant="caption" tone="subtle">
                {unrecorded}
              </Txt>
            )}
          </Block>
        ) : null}

        {reason ? (
          <Block style={{ backgroundColor: theme.s1 }} testID="rejection">
            <View style={styles.headingRow}>
              <Txt variant="section">
                {t(a.status === "APPEAL_REJECTED" ? "soul_app.detail.appeal_rejection_reason" : "soul_app.detail.rejection_reason")}
              </Txt>
              {a.decided_at ? (
                <Txt variant="value" tone="subtle" style={styles.meta}>
                  {formatStamp(a.decided_at)}
                </Txt>
              ) : null}
            </View>
            <Quote text={reason} tone="rejection" />
          </Block>
        ) : null}

        {a.appeal_statement ? (
          <Block>
            <Txt variant="section" style={styles.headingTight}>
              {t("soul_app.detail.appeal_statement")}
            </Txt>
            <Quote text={a.appeal_statement} tone="appeal" />
          </Block>
        ) : null}

        {a.can_appeal ? (
          <Block last testID="appeal" style={styles.appealBlock}>
            <View>
              <Txt variant="section">{t("soul_app.detail.appeal")}</Txt>
              <Txt variant="caption" tone="subtle" style={styles.hint}>
                {residence ? t("soul_app.detail.appeal_hint_residing", { home: residence.home }) : t("soul_app.detail.appeal_hint")}
              </Txt>
            </View>
            <Input
              testID="appeal-statement"
              label={t("soul_app.detail.appeal_statement")}
              value={appeal}
              onChangeText={setAppeal}
              multiline
              maxLength={2000}
            />
            {error ? <Notice tone="neg">{t(error.key, error.params)}</Notice> : null}
            <Button
              testID="submit-appeal"
              title={t(busy ? "soul_app.applications.submitting" : "soul_app.detail.appeal_submit")}
              onPress={submitAppeal}
              busy={busy}
            />
          </Block>
        ) : null}
      </FadeIn>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  pressed: { opacity: 0.8 },
  gap4: { marginTop: 4 },
  gap10: { marginTop: 10 },
  cooldown: { marginTop: 6, marginLeft: 22 },
  appRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: GUTTER, paddingVertical: 18, borderBottomWidth: 1 },
  stack: { gap: 22 },
  note: { borderLeftWidth: 2, paddingLeft: 12 },
  heading: { marginBottom: 12 },
  headingTight: { marginBottom: 11 },
  headingRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", columnGap: 8, marginBottom: 12 },
  meta: { fontSize: 11 },
  forms: { gap: 1 },
  formCard: { flexDirection: "row", alignItems: "flex-start", gap: 13, paddingVertical: 15, paddingHorizontal: 14, borderLeftWidth: 2 },
  dot: { width: 16, height: 16, marginTop: 4, borderRadius: 999, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  dotFill: { width: 8, height: 8, borderRadius: 999 },
  formName: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: 8 },
  formCode: { fontSize: 11, letterSpacing: 1.1 },
  statement: { marginTop: 4 },
  formTitle: { marginTop: 14 },
  landingRule: { position: "absolute", left: 0, top: 0, bottom: 0, width: 3 },
  landingTag: { position: "absolute", top: 12, right: 12, borderWidth: 1, paddingHorizontal: 6, paddingVertical: 2 },
  landingTagText: { fontSize: 10.5, letterSpacing: 0.4 },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  badgeItem: { flexShrink: 0, maxWidth: "100%" },
  handler: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  handlerText: { letterSpacing: 0.4 },
  residenceNote: { flexDirection: "row", gap: 9, paddingVertical: 14, borderBottomWidth: 1 },
  nudge: { marginTop: 3 },
  facts: { marginTop: 16 },
  step: { flexDirection: "row", columnGap: 14 },
  rail: { width: 22, alignItems: "center" },
  stepDot: { width: 11, height: 11, marginTop: 5 },
  stepLine: { flex: 1, width: 1, marginVertical: 4 },
  stepLineDashed: { flex: 1, width: 0, marginVertical: 4, borderLeftWidth: 1, borderStyle: "dashed" },
  stepDotLarge: { width: 16, height: 16, marginTop: 3 },
  railStacked: { width: 16 },
  terminal: { alignItems: "center", gap: 12, paddingHorizontal: 28, paddingVertical: 40 },
  center: { textAlign: "center" },
  stepGap: { paddingBottom: 22 },
  stepName: { fontSize: 14, lineHeight: 21 },
  stepWhen: { fontSize: 12, marginTop: 3 },
  hint: { marginTop: 8 },
  appealBlock: { gap: 14, paddingBottom: 34 },
});
