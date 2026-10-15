"use client";

import { useId, useRef, useState } from "react";
import { minLengthRuleKey, PASSWORD_MIN_LENGTH, passwordRulesMet, passwordsMatch, ruleDisplay, unmetRules, type PasswordRule, type RuleDisplay } from "@soulledger/core/domain/passwordRules";
import { useI18n } from "@/src/contexts/I18nContext";
import { Field, fieldControl } from "@/src/components/ui/Field";
import { cn } from "@/lib/utils";

/**
 * 设新密码的两个框加逐条要求(Design 第二十三批,官员台 B)。规则本身在 `@soulledger/core/domain/passwordRules`;
 * 这里只管状态与画法:
 * - 一进页面就列着,全是 ○;输入时只会 ○ → ✓,不标红;
 * - 框失去焦点、或点过保存之后,它名下没达标的才是 `!`(danger、加粗)并描红;已是 `!` 的改到达标立刻 ✓;
 * - 保存一直可点,没达标就不发请求(`check()` 返回 false);
 * - 服务器以「太常见 / 太像」拒绝(`reject()`):◇ 那行换成报错,前面各条仍是 ✓,框描红、焦点回新密码框并全选。
 * 输入时不用 live region;只在离开框、点保存、服务器拒绝这三个时刻用 `role="alert"` 播报。
 */
export function usePasswordRules(current?: string, minLength = PASSWORD_MIN_LENGTH) {
  const { t } = useI18n();
  const [next, setNextValue] = useState("");
  const [confirm, setConfirm] = useState("");
  const [nextLeft, setNextLeft] = useState(false);
  const [confirmLeft, setConfirmLeft] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [rejected, setRejected] = useState(false);
  const [announce, setAnnounce] = useState<string | null>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const unmet = unmetRules(next, current, minLength);
  const mismatch = !passwordsMatch(next, confirm);

  const ruleKey = (rule: PasswordRule) => (rule === "min_length" ? minLengthRuleKey(minLength) : `password_rules.${rule}`);
  const summary = (rules: PasswordRule[], matchBad: boolean) => {
    const list = [...rules.map((rule) => t(ruleKey(rule))), ...(matchBad ? [t("password_rules.match")] : [])];
    return t("password_rules.summary", { n: String(list.length), list: list.join(", ") });
  };

  return {
    current, minLength, next, confirm, nextRef, confirmRef, announce, rejected,
    judgedNext: nextLeft || submitted,
    judgedConfirm: confirmLeft || submitted,
    setNext: (value: string) => {
      setNextValue(value);
      setRejected(false);
    },
    setConfirm,
    leaveNext: () => {
      setNextLeft(true);
      if (unmet.length) setAnnounce(summary(unmet, false));
    },
    leaveConfirm: () => {
      setConfirmLeft(true);
      if (mismatch && confirm.length) setAnnounce(t("password_rules.match_bad"));
    },
    /** 点保存 / 按 Enter:全达标返回 true;否则标出没达标的、焦点移到第一个有问题的框、播报 summary。 */
    check: (): boolean => {
      setSubmitted(true);
      if (!unmet.length && !mismatch) {
        setAnnounce(null);
        return true;
      }
      setAnnounce(summary(unmet, mismatch));
      (unmet.length ? nextRef : confirmRef).current?.focus();
      return false;
    },
    /** 服务器说「太常见 / 太像」:打勾不撤回,内容保留,焦点回新密码框并全选。 */
    reject: () => {
      setSubmitted(true);
      setRejected(true);
      setAnnounce(null);
      nextRef.current?.focus();
      nextRef.current?.select();
    },
    reset: () => {
      setNextValue("");
      setConfirm("");
      setNextLeft(false);
      setConfirmLeft(false);
      setSubmitted(false);
      setRejected(false);
      setAnnounce(null);
    },
  };
}

export type PasswordRulesState = ReturnType<typeof usePasswordRules>;

const SYMBOL: Record<RuleDisplay | "note", string> = { idle: "○", ok: "✓", bad: "!", note: "◇" };

/** 一行:符号(读屏隐藏)+ 文字;✓ / ! 带读屏后缀,○ 不加。 */
function Row({ state, children, testId }: { state: RuleDisplay | "note"; children: string; testId?: string }) {
  const { t } = useI18n();
  const quiet = state === "idle" || state === "note";
  return (
    <li
      data-testid={testId}
      data-state={state}
      className={cn(
        "flex items-baseline gap-2",
        quiet && "text-[oklch(var(--color-ink-muted))]",
        state === "ok" && "font-medium text-[oklch(var(--color-ink))]",
        state === "bad" && "font-semibold text-[oklch(var(--color-danger))]"
      )}
    >
      <span aria-hidden="true" className="w-4 shrink-0 text-center">{SYMBOL[state]}</span>
      <span>
        {children}
        {state === "ok" || state === "bad" ? <span className="sr-only">, {t(`password_rules.state_${state}`)}</span> : null}
      </span>
    </li>
  );
}

/**
 * 新密码框 + 要求清单 + 确认框 + 「两次一致」。`wide` 时(窗口 ≥ 720)清单在新密码框右侧、与框顶对齐,
 * 「两次一致」在确认框右侧;其余宽度,以及 `wide={false}` 的窄卡片里,它们都在各自的框下面。
 */
export function PasswordRuleFields({
  rules,
  idPrefix,
  newLabel,
  confirmLabel,
  wide = false,
}: {
  rules: PasswordRulesState;
  idPrefix: string;
  newLabel: string;
  confirmLabel: string;
  wide?: boolean;
}) {
  const { t } = useI18n();
  const listId = useId();
  const matchId = useId();
  const met = passwordRulesMet(rules.next, rules.current, rules.minLength);
  const matched = passwordsMatch(rules.next, rules.confirm);
  const matchState = ruleDisplay(matched, rules.judgedConfirm);
  const nextBad = rules.rejected || (rules.judgedNext && Object.values(met).some((ok) => !ok));
  const confirmBad = matchState === "bad";
  const order: PasswordRule[] = ["min_length", "not_digits", "not_current"];

  return (
    <div className={cn("grid grid-cols-1 gap-x-8 gap-y-4", wide && "min-[720px]:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]")}>
      <Field id={`${idPrefix}-new`} label={newLabel} required>
        {(control) => (
          <input
            {...control}
            type="password"
            name="new_password"
            autoComplete="new-password"
            ref={rules.nextRef}
            value={rules.next}
            onChange={(e) => rules.setNext(e.target.value)}
            onBlur={rules.leaveNext}
            aria-invalid={nextBad || undefined}
            aria-describedby={listId}
            className={fieldControl({ invalid: nextBad })}
          />
        )}
      </Field>
      <div className={cn("text-sm", wide && "min-[720px]:pt-[22px]")}>
        {rules.rejected ? (
          <div role="alert" data-testid="password-rules-common" className="mb-1 text-[oklch(var(--color-danger))]">
            <p className="flex items-baseline gap-2 font-semibold">
              <span aria-hidden="true" className="w-4 shrink-0 text-center">!</span>
              {t("password_rules.common_title")}
            </p>
            <p className="pl-6 font-normal text-[oklch(var(--color-ink-muted))]">{t("password_rules.common_body")}</p>
          </div>
        ) : null}
        <ul id={listId} data-testid="password-rules-list" className="m-0 flex list-none flex-col gap-1 p-0">
          {order.filter((rule) => rule in met).map((rule) => (
            <Row key={rule} testId={`password-rule-${rule}`} state={ruleDisplay(Boolean(met[rule]), rules.judgedNext)}>
              {t(rule === "min_length" ? minLengthRuleKey(rules.minLength) : `password_rules.${rule}`)}
            </Row>
          ))}
          {rules.rejected ? null : <Row state="note" testId="password-rule-note">{t("password_rules.note")}</Row>}
        </ul>
      </div>
      <Field id={`${idPrefix}-confirm`} label={confirmLabel} required>
        {(control) => (
          <input
            {...control}
            type="password"
            name="confirm_password"
            autoComplete="new-password"
            ref={rules.confirmRef}
            value={rules.confirm}
            onChange={(e) => rules.setConfirm(e.target.value)}
            onBlur={rules.leaveConfirm}
            aria-invalid={confirmBad || undefined}
            aria-describedby={matchId}
            className={fieldControl({ invalid: confirmBad })}
          />
        )}
      </Field>
      <ul id={matchId} data-testid="password-rules-match" className={cn("m-0 list-none p-0 text-sm", wide && "min-[720px]:pt-[22px]")}>
        <Row state={matchState} testId="password-rule-match">{t(matchState === "bad" ? "password_rules.match_bad" : "password_rules.match")}</Row>
      </ul>
      {rules.announce ? (
        <p role="alert" data-testid="password-rules-announce" className="sr-only">{rules.announce}</p>
      ) : null}
    </div>
  );
}
