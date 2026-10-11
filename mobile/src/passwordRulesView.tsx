/**
 * 设新密码时在输入框下逐条列出要求(第二十三批 Design 回复)。两个 App 的五个设新密码页共用:
 * 灵魂端的改密码(首次登录 / 设置)与忘记密码第 2 步,官员端的修改密码与重置密码。
 *
 * 规则本身在 `@soulledger/core/domain/passwordRules`;这里只画,并把「什么时候标 !」「点保存做什么」
 * 「服务器说太常见」「键盘弹出时滚到哪」这几件每页都一样的事收进 `usePasswordForm`。
 *
 * 状态:○ 还没达标(用户还在输时没达标也只是 ○)、✓ 达标、! 离开过这个框或点过保存之后仍没达标。
 * ✓ 不用绿色(规范里没有成功色),靠符号和字重分;符号对读屏隐藏,每条的读法是「文字 + 状态后缀」。
 */
import {
  passwordRulesMet,
  passwordsMatch,
  ruleDisplay,
  unmetRules,
  type PasswordRule,
  type RuleDisplay,
} from "@soulledger/core/domain/passwordRules";
import { useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, Keyboard, StyleSheet, View, type ScrollView, type TextInput } from "react-native";

import { family } from "./fonts";
import { useI18n } from "./i18n";
import { Txt, useTheme } from "./ui";

const RULE_ORDER: readonly PasswordRule[] = ["min_length", "not_digits", "not_current"];
const SCROLL_TOP_GAP = 24;

function Mark({ display, glyph, testID }: { display: RuleDisplay | "note"; glyph: string; testID?: string }) {
  const theme = useTheme();
  return (
    <Txt
      testID={testID}
      accessibilityElementsHidden
      importantForAccessibility="no"
      style={[
        styles.mark,
        { color: display === "bad" ? theme.neg : display === "ok" ? theme.ink : theme.inkMuted },
        display === "ok" || display === "bad" ? styles.markStrong : null,
      ]}
    >
      {glyph}
    </Txt>
  );
}

function Line({ display, text, testID }: { display: RuleDisplay; text: string; testID: string }) {
  const { t } = useI18n();
  const theme = useTheme();
  const suffix = display === "ok" ? t("password_rules.state_ok") : display === "bad" ? t("password_rules.state_bad") : "";
  return (
    <View testID={testID} accessible accessibilityLabel={suffix ? `${text}，${suffix}` : text} style={styles.row}>
      <Mark display={display} glyph={display === "ok" ? "✓" : display === "bad" ? "!" : "○"} testID={`${testID}-mark`} />
      <Txt
        style={[
          styles.text,
          { color: display === "bad" ? theme.neg : display === "ok" ? theme.ink : theme.inkMuted },
          display === "ok" ? styles.textOk : display === "bad" ? styles.textBad : null,
        ]}
      >
        {text}
      </Txt>
    </View>
  );
}

/**
 * 新密码框下的清单。`old`(当前密码)传 `undefined` = 这一页没有「当前密码」框(第 3 条不出现)。
 * `judged`:离开过新密码框,或点过保存。`common`:服务器刚以「太常见 / 太像」拒绝了这个密码。
 */
export function PasswordRules({
  next,
  old,
  judged,
  common,
  testID = "pw-rules",
}: {
  next: string;
  old?: string;
  judged: boolean;
  common?: boolean;
  testID?: string;
}) {
  const { t } = useI18n();
  const theme = useTheme();
  const met = passwordRulesMet(next, old);
  return (
    <View style={styles.list}>
      {common ? (
        <View testID={`${testID}-common`} accessibilityRole="alert" accessible style={styles.common}>
          <Txt testID={`${testID}-common-title`} style={[styles.text, styles.textBad, { color: theme.neg }]}>{`! ${t("password_rules.common_title")}`}</Txt>
          <Txt testID={`${testID}-common-body`} style={[styles.text, { color: theme.inkMuted }]}>{t("password_rules.common_body")}</Txt>
        </View>
      ) : null}
      {RULE_ORDER.filter((rule) => rule in met).map((rule) => (
        <Line key={rule} testID={`${testID}-${rule}`} display={ruleDisplay(!!met[rule], judged)} text={t(`password_rules.${rule}`)} />
      ))}
      {common ? null : (
        <View testID={`${testID}-note`} style={[styles.row, styles.note]}>
          <Mark display="note" glyph="◇" />
          <Txt style={[styles.text, { color: theme.inkMuted }]}>{t("password_rules.note")}</Txt>
        </View>
      )}
    </View>
  );
}

/** 确认框下的「两次输入一致」。 */
export function PasswordMatch({ next, confirm, judged, testID = "pw-match" }: { next: string; confirm: string; judged: boolean; testID?: string }) {
  const { t } = useI18n();
  const display = ruleDisplay(passwordsMatch(next, confirm), judged);
  return <Line testID={testID} display={display} text={t(display === "bad" ? "password_rules.match_bad" : "password_rules.match")} />;
}

/**
 * 一个设新密码页要的全部状态。`old`(当前密码)为 `undefined` = 没有「当前密码」框。
 * 调用方把 `fields.*` 展开到对应的 `Input` 上,把 `holdScroller` 给 `Screen` 的 `scrollRef`、`holdSection` 给包着「新密码」框与清单的 View,
 * 点保存时先问 `check()`:返回 false 就不发请求(变 !、焦点已移走、已念出 summary)。
 * 服务器以「太常见」拒绝时调 `rejectCommon()`。
 *
 * 调用方要把结果整个解构成局部变量再用:写成 `form.check()` / `form.holdScroller` 时,react-hooks/refs
 * 会把整个 `form` 当成 ref 逐处报「渲染期间读 ref」(2026-10-11 实测,四个页面都是),解构后一条不报。
 * 输入框与滚动容器用 state 里的回调 ref 持有,不用 ref 对象,理由同上。
 */
export function usePasswordForm({ old, next, confirm }: { old?: string; next: string; confirm: string }) {
  const { t, locale } = useI18n();
  const [newJudged, setNewJudged] = useState(false);
  const [confirmJudged, setConfirmJudged] = useState(false);
  // 被拒绝的是哪一个密码:再改一个字就不再算「太常见」(那个新密码还没被判过)。
  const [rejected, setRejected] = useState<string | null>(null);
  // The boxes are held in state through callback refs. A ref object handed out by a hook makes react-hooks/refs read every
  // other field of the hook's result as "a ref read during render" at each call site.
  const [currentBox, holdCurrent] = useState<TextInput | null>(null);
  const [nextBox, holdNext] = useState<TextInput | null>(null);
  const [confirmBox, holdConfirm] = useState<TextInput | null>(null);
  const [scroller, holdScroller] = useState<ScrollView | null>(null);
  const [section, holdSection] = useState<View | null>(null);
  const [newFocused, setNewFocused] = useState(false);
  const common = rejected !== null && rejected === next;

  const scrollToNew = useCallback(() => {
    // `getInnerViewRef` is in the runtime (ScrollView.js) but not in the .d.ts, which only has the deprecated node-handle one.
    const inner = (scroller as { getInnerViewRef?: () => unknown } | null)?.getInnerViewRef?.();
    if (!scroller || !inner || !section) return;
    section.measureLayout(
      inner as never,
      (_x, y) => scroller.scrollTo({ y: Math.max(0, y - SCROLL_TOP_GAP), animated: true }),
      () => {}
    );
  }, [scroller, section]);
  // 键盘升起后可视高度才缩小,焦点那一刻滚过去会被旧的可滚范围夹住。
  useEffect(() => {
    if (!newFocused) return;
    const sub = Keyboard.addListener("keyboardDidShow", scrollToNew);
    return () => sub.remove();
  }, [newFocused, scrollToNew]);

  const unmet = unmetRules(next, old);
  const mismatch = !passwordsMatch(next, confirm);
  const summary = (): string => {
    const lines = [...unmet.map((rule) => t(`password_rules.${rule}`)), ...(mismatch ? [t("password_rules.match_bad")] : [])];
    return t("password_rules.summary", { n: String(lines.length), list: lines.join(locale === "en" ? ", " : "、") });
  };
  const announce = (text: string) => void AccessibilityInfo.announceForAccessibility(text);

  const fields = {
    old: { inputRef: holdCurrent },
    next: {
      inputRef: holdNext,
      invalid: common || (newJudged && unmet.length > 0),
      onFocus: () => {
        setNewFocused(true);
        scrollToNew();
      },
      onBlur: () => {
        setNewFocused(false);
        setNewJudged(true);
        if (unmet.length > 0) announce(summary());
      },
    },
    confirm: {
      inputRef: holdConfirm,
      invalid: confirmJudged && mismatch,
      onBlur: () => {
        setConfirmJudged(true);
        if (mismatch) announce(t("password_rules.match_bad"));
      },
    },
  };

  /** 点保存:有没达标的就不发请求。 */
  const check = (): boolean => {
    setNewJudged(true);
    setConfirmJudged(true);
    const missingCurrent = old !== undefined && old.length === 0;
    if (!missingCurrent && unmet.length === 0 && !mismatch) return true;
    (missingCurrent ? currentBox : unmet.length > 0 ? nextBox : confirmBox)?.focus();
    announce(summary());
    return false;
  };

  /** 服务器以「太常见 / 太像」拒绝:清单上方换成报错,前三条与一致仍是 ✓,焦点回新密码框并全选。 */
  const rejectCommon = () => {
    setRejected(next);
    setNewJudged(true);
    nextBox?.focus();
    nextBox?.setSelection?.(0, next.length);
    announce(`${t("password_rules.common_title")}。${t("password_rules.common_body")}`);
  };

  return { fields, holdScroller, holdSection, newJudged, confirmJudged, common, check, rejectCommon };
}

const styles = StyleSheet.create({
  list: { gap: 4 },
  row: { flexDirection: "row", gap: 8, alignItems: "baseline" },
  note: { paddingTop: 4 },
  common: { gap: 0, paddingBottom: 4 },
  mark: { width: 16, textAlign: "center", fontSize: 13, lineHeight: 20, fontFamily: family.ui[400] },
  markStrong: { fontFamily: family.ui[600] },
  text: { flex: 1, fontSize: 13, lineHeight: 20, fontFamily: family.ui[400] },
  textOk: { fontFamily: family.ui[500] },
  textBad: { fontFamily: family.ui[600] },
});
