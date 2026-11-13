/**
 * 卷宗的「判」抽屉(Design 第三十批 第 3 步 八.6 / 十二.6):去处一行一个(行高 56,编号),判词,印的虚线预览,
 * 「按住落印」—— 按住 1 秒落印,防误触,代替网页的 ⌘↵;按住时印从虚线渐成实印,松手前可以取消。
 *
 * 去处:手机上能落的只有现有 `conclude/` 接受的两个判决 —— 通过 / 不过(不过要选理由,同滑卡审判,`RejectFields`);
 * 发落交给自动选殿,要自选去处或引用条文的案子在官员台做(同 swipe.tsx 的口径)。样张里的四个去处是演示用的(十二.8)。
 * 埃及天平已称出的,反方向那一行不可选(`blockedSide`)。
 * 落印走 `confirmedDecision`(我的 › 批准前验证面容 / 指纹),发 `submitVerdict`,与滑卡审判同一个调用。
 */
import type { GreekAccount, JudgmentDetail } from "@soulledger/core/api/judgment";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";

import { submitVerdict } from "../decisions";
import { confirmedDecision } from "../deviceCheck";
import { DossierSeal } from "../dossierSeal";
import { Input, Sheet, Txt, family, radius, space, useI18n, useOnline, useReducedMotion, useTheme, useToast } from "../shared";
import { GR_ACCOUNTS, NO_SEAL, blockedSide, sealPayload, sealReady, type SealChoice, type SealVerdict } from "../verdict";
import { Choice, RejectFields } from "./rejectSheet";
import { verdictFailure } from "./swipe";

/** 按住多久落印(十二.6)。 */
export const HOLD_TO_SEAL_MS = 1000;
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
        toast(t("officer_app.seal.done"), "success");
        onSealed();
      })
      .catch((e: unknown) => toast(verdictFailure(t, e), "failure"))
      .finally(() => setBusy(false));
  };

  const options: { verdict: SealVerdict; label: string; off: boolean }[] = [
    { verdict: "PASSED", label: t("judgment.verdicts.passed"), off: blocked === "right" },
    { verdict: "FAILED", label: t("judgment.verdicts.failed"), off: blocked === "left" },
  ];

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
              accessibilityState={{ checked: on, disabled: o.off }}
              disabled={o.off}
              onPress={() => setC((prev) => ({ ...prev, verdict: o.verdict }))}
              style={[styles.option, { borderColor: on ? theme.ink : theme.hair2, borderWidth: on ? 1.5 : 1, opacity: o.off ? 0.45 : 1 }]}
            >
              <Txt variant="caption" tone="muted" style={styles.ordinal}>
                {String(i + 1)}
              </Txt>
              <View style={{ flex: 1 }}>
                <Txt variant="body" style={{ fontFamily: on ? family.ui[500] : family.ui[400] }}>
                  {o.label}
                </Txt>
                {o.off ? (
                  <Txt variant="caption" tone="muted">
                    {t("reject_reason.eg.scale_decided")}
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
 */
function HoldToSeal({ judgment, disabled, busy, hint, onSeal }: { judgment: JudgmentDetail; disabled: boolean; busy: boolean; hint: string; onSeal: () => void }) {
  const { t } = useI18n();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const fill = useRef(new Animated.Value(0)).current;
  const fired = useRef(false);
  useEffect(() => {
    if (!busy) fill.setValue(0);
  }, [busy, fill]);
  const pressIn = () => {
    fired.current = false;
    if (!reduced) Animated.timing(fill, { toValue: 1, duration: HOLD_TO_SEAL_MS, useNativeDriver: true }).start();
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
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: fill }]} importantForAccessibility="no-hide-descendants">
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
          fill.setValue(1);
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
