/**
 * 卷宗的「判」抽屉(Design 第三十批 第 3 步 八.6 / 十二.6):去处一行一个(行高 56,编号),判词,印的虚线预览,
 * 「按住落印」—— 按住 1 秒落印,防误触,代替网页的 ⌘↵;按住时印从虚线渐成实印,松手前可以取消。
 *
 * 判决:与网页审判台同样四个(用户 2026-11-13)—— 通过 / 不过 / 存疑(按文明叫炼狱、天平摇摆、普通,`verdictText`)/ 重审;
 * 不过要选理由(同滑卡审判,`RejectFields`),希腊通过要选文书。发落交给自动选殿,要自选去处或引用条文的案子在官员台做
 * (同 swipe.tsx 的口径)。样张里的四个去处文字是演示用的(十二.8)。置灰同网页的 `barredBy`:五逆不能通过;埃及天平已称出的,
 * 反方向那一行不可选(`blockedSide`)。别的拒绝(如欧洲未受洗不能判炼狱)由服务端回,抽屉照它回的那句写出(`verdictFailure`)。
 * 落印走 `confirmedDecision`(我的 › 批准前验证面容 / 指纹),发 `submitVerdict`,与滑卡审判同一个调用。
 */
import type { GreekAccount, JudgmentDetail } from "@soulledger/core/api/judgment";
import { verdictText } from "@soulledger/core/domain/verdictNames";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";

import { submitVerdict } from "../decisions";
import { DECISION_TOAST, confirmedDecision, decisionFailureKind } from "../deviceCheck";
import { DossierSeal } from "../dossierSeal";
import { Input, Sheet, Txt, family, radius, space, useI18n, useOnline, useReducedMotion, useTheme, useToast } from "../shared";
import { GR_ACCOUNTS, NO_SEAL, SEAL_VERDICTS, blockedSide, passBarredBy, sealPayload, sealReady, type SealChoice, type SealVerdict } from "../verdict";
import { Choice, RejectFields } from "./rejectSheet";
import { verdictFailure } from "./swipe";

/** 按住多久落印(十二.6)。 */
export const HOLD_TO_SEAL_MS = 1000;

/** The seal's feel (官员端真机 2026-11-14: it had none): a tick as the hold starts, a firm knock as the seal lands, the
 *  system's success / error buzz on the server's answer. The system's own haptics setting turns them off; a phone
 *  without a motor just does nothing. */
const buzz = (p: Promise<void>) => void p.catch(() => {});
const NOTES_MAX = 2000;

export function SealSheet({ open, judgment, onClose, onSealed }: { open: boolean; judgment: JudgmentDetail; onClose: () => void; onSealed: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const toast = useToast();
  const { offline } = useOnline();
  const civ = judgment.civilization;
  const [c, setC] = useState<SealChoice>(NO_SEAL);
  const [busy, setBusy] = useState(false);
  const blocked = blockedSide(judgment);
  const ready = sealReady(civ, c) && !offline && !busy;

  const seal = () => {
    if (!ready) return;
    setBusy(true);
    confirmedDecision(t("officer_app.biometric.prompt"), () => submitVerdict(judgment.id, sealPayload(civ, c)))
      .then(() => {
        buzz(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
        toast(t("officer_app.seal.done"), "success", DECISION_TOAST);
        onSealed();
      })
      .catch((e: unknown) => {
        if (decisionFailureKind(e) === "failure") buzz(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
        toast(verdictFailure(t, e), decisionFailureKind(e), DECISION_TOAST);
      })
      .finally(() => setBusy(false));
  };

  // Barred as the web desk bars them (`barredBy`): 通过 by 五逆, and on a weighed 埃及 case the side the scale ruled out.
  const passBarred = passBarredBy(judgment);
  const why = (v: SealVerdict): string | null =>
    v === "PASSED" && passBarred ? t(passBarred) : (v === "PASSED" && blocked === "right") || (v === "FAILED" && blocked === "left") ? t("reject_reason.eg.scale_decided") : null;
  const options = SEAL_VERDICTS.map((verdict) => ({ verdict, label: verdictText(t, civ, verdict), why: why(verdict) }));

  return (
    <Sheet open={open} onClose={onClose} edge={theme.hair} closeLabel={t("reject.sheet.cancel")}>
      <View testID="seal-sheet" style={{ padding: space[5], gap: space[3] }}>
        <Txt variant="title">{t("officer_app.seal.title", { name: judgment.soul_name })}</Txt>
        {options.map((o, i) => {
          const on = c.verdict === o.verdict;
          return (
            <Pressable
              key={o.verdict}
              testID={`seal-option-${o.verdict}`}
              accessibilityRole="radio"
              accessibilityState={{ checked: on, disabled: !!o.why }}
              disabled={!!o.why}
              onPress={() => setC((prev) => ({ ...prev, verdict: o.verdict }))}
              style={[styles.option, { borderColor: on ? theme.ink : theme.hair2, borderWidth: on ? 1.5 : 1, opacity: o.why ? 0.45 : 1 }]}
            >
              <Txt variant="caption" tone="muted" style={styles.ordinal}>
                {String(i + 1)}
              </Txt>
              <View style={{ flex: 1 }}>
                <Txt variant="body" style={{ fontFamily: on ? family.ui[500] : family.ui[400] }}>
                  {o.label}
                </Txt>
                {o.why ? (
                  <Txt variant="caption" tone="muted">
                    {o.why}
                  </Txt>
                ) : null}
              </View>
            </Pressable>
          );
        })}
        <Txt variant="caption" tone="muted">
          {t("officer_app.seal.auto_route")}
        </Txt>

        {c.verdict === "PASSED" && civ === "GREEK"
          ? GR_ACCOUNTS.map((a: GreekAccount) => (
              <Choice
                key={a}
                testID={`seal-account-${a}`}
                label={t(a === "GORGIAS" ? "judgment.greek_account.gorgias" : "judgment.greek_account.republic")}
                sub={t(a === "GORGIAS" ? "judgment.greek_account.gorgias_pass" : "judgment.greek_account.republic_pass")}
                on={c.account === a}
                onPress={() => setC((prev) => ({ ...prev, account: a }))}
              />
            ))
          : null}
        {c.verdict === "FAILED" ? (
          <RejectFields open={open} judgment={judgment} choice={c.reject} onChange={(next) => setC((prev) => ({ ...prev, reject: next(prev.reject) }))} />
        ) : null}

        <Input
          testID="seal-notes"
          label={t("officer_app.seal.verdict_label")}
          multiline
          maxLength={NOTES_MAX}
          value={c.notes}
          onChangeText={(notes) => setC((prev) => ({ ...prev, notes }))}
        />

        <HoldToSeal
          judgment={judgment}
          disabled={!ready}
          busy={busy}
          hint={offline ? t("officer_app.offline.no_decide") : t("officer_app.seal.hold_note")}
          onSeal={seal}
        />
      </View>
    </Sheet>
  );
}

/**
 * The pending seal over the solid one, and 「按住落印」 under them. Pressing in starts the 1 s fill (the dashed seal
 * gives way to the solid one); letting go before it is full puts it back. The seal is set by `onLongPress` with
 * `delayLongPress` = 1 s, a Pressable's own timer (CLAUDE.md: long presses here are `delayLongPress`, not gestures).
 * Under reduce-motion there is no fill; the hold is still 1 s.
 * Landing is a stamp, not a fade (官员端真机 2026-11-14): while held the solid seal hangs lifted at 1.25×, and when it
 * lands it springs down to 1× with a little overshoot (about 250 ms) while a copy of it spreads out and fades, the
 * ink taking to the paper. Under reduce-motion the solid seal just appears at 1×. Transforms and opacity only (native driver).
 */
export const SEAL_LIFT = 1.25;
function HoldToSeal({ judgment, disabled, busy, hint, onSeal }: { judgment: JudgmentDetail; disabled: boolean; busy: boolean; hint: string; onSeal: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const [fill] = useState(() => new Animated.Value(0));
  const [drop] = useState(() => new Animated.Value(1));
  const [ink] = useState(() => new Animated.Value(0));
  const fired = useRef(false);
  useEffect(() => {
    if (!busy) fill.setValue(0);
  }, [busy, fill]);
  const pressIn = () => {
    fired.current = false;
    buzz(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
    if (reduced) return;
    drop.setValue(SEAL_LIFT);
    Animated.timing(fill, { toValue: 1, duration: HOLD_TO_SEAL_MS, useNativeDriver: true }).start();
  };
  const land = () => {
    if (reduced) return drop.setValue(1);
    ink.setValue(0);
    Animated.parallel([
      Animated.spring(drop, { toValue: 1, tension: 260, friction: 9, useNativeDriver: true }),
      Animated.timing(ink, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
    ]).start();
  };
  const pressOut = () => {
    if (fired.current) return;
    fill.stopAnimation();
    fill.setValue(0);
  };
  const pending = fill.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });
  const label = t("officer_app.seal.hold");
  return (
    <>
      <View style={[styles.preview, { borderTopColor: theme.hair }]}>
        <View style={styles.seals}>
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: pending }]}>
            <DossierSeal testID="seal-pending" civilization={judgment.civilization} court={judgment.court} pending label={t("officer_app.seal.pending_a11y")} />
          </Animated.View>
          <Animated.View
            testID="seal-ink"
            style={[StyleSheet.absoluteFill, { opacity: ink.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.35, 0] }), transform: [{ scale: ink.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] }) }] }]}
            importantForAccessibility="no-hide-descendants"
          >
            <DossierSeal civilization={judgment.civilization} court={judgment.court} label="" />
          </Animated.View>
          <Animated.View testID="seal-solid" style={[StyleSheet.absoluteFill, { opacity: fill, transform: [{ scale: drop }] }]} importantForAccessibility="no-hide-descendants">
            <DossierSeal civilization={judgment.civilization} court={judgment.court} label={t("officer_app.seal.a11y")} />
          </Animated.View>
        </View>
        <Txt variant="caption" tone="muted" style={{ flex: 1 }}>
          {hint}
        </Txt>
      </View>
      <Pressable
        testID="seal-hold"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled: disabled || busy, busy }}
        accessibilityActions={[{ name: "longpress", label }]}
        onAccessibilityAction={(e) => e.nativeEvent.actionName === "longpress" && !disabled && !busy && onSeal()}
        disabled={disabled || busy}
        delayLongPress={HOLD_TO_SEAL_MS}
        onPressIn={pressIn}
        onPressOut={pressOut}
        onLongPress={() => {
          fired.current = true;
          buzz(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy));
          fill.setValue(1);
          land();
          onSeal();
        }}
        style={[styles.hold, { backgroundColor: disabled ? theme.s2 : theme.ink, opacity: busy ? 0.7 : 1 }]}
      >
        <Txt variant="nav" style={{ color: disabled ? theme.inkSubtle : theme.s0 }}>
          {label}
        </Txt>
      </Pressable>
    </>
  );
}

const styles = StyleSheet.create({
  option: { minHeight: 56, flexDirection: "row", alignItems: "center", gap: space[3], paddingHorizontal: space[4], paddingVertical: space[2], borderRadius: radius.control },
  ordinal: { width: 16, textAlign: "center" },
  preview: { flexDirection: "row", alignItems: "center", gap: space[4], paddingTop: space[3], borderTopWidth: StyleSheet.hairlineWidth },
  seals: { width: 96, height: 96 },
  hold: { minHeight: 56, alignItems: "center", justifyContent: "center", borderRadius: radius.control },
});
