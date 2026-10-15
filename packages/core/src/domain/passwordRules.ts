/**
 * 设新密码时逐条列出的要求(第二十三批 Design 回复)。这里只有手机 / 浏览器自己能判断的四条;
 * 「太常见」「和名字或编号太像」只有服务器知道(`backend/config/settings.py` 的 AUTH_PASSWORD_VALIDATORS),
 * 清单里是一行不打勾的说明。纯函数,不碰 DOM,Web 与两个 App 共用。
 *
 * 最小长度必须和 Django 的 MinimumLengthValidator 默认值一致 —— 守卫在
 * `frontend/src/__tests__/passwordRulesMatchBackend.test.ts`。管理员(ADMIN)的更长(12),
 * 与 `backend/apps/authentication/passwords.py` 的 `ADMIN_MIN_PASSWORD_LENGTH` 同一个数,同一份守卫。
 */
export const PASSWORD_MIN_LENGTH = 8;
export const ADMIN_PASSWORD_MIN_LENGTH = 12;

/** 这个角色设密码至少几位。灵魂端没有角色,不传。 */
export const passwordMinLength = (role?: string): number => (role === "ADMIN" ? ADMIN_PASSWORD_MIN_LENGTH : PASSWORD_MIN_LENGTH);

/** 「至少 N 位」那一条用哪个词条:默认 8 位的一条,管理员 12 位的另一条。 */
export const minLengthRuleKey = (minLength: number): string =>
  minLength > PASSWORD_MIN_LENGTH ? "password_rules.min_length_admin" : "password_rules.min_length";

export type PasswordRule = "min_length" | "not_digits" | "not_current";
/** ○ 还没达标(也还没被判)、✓ 达标、! 没达标且已经离开框或点过保存。 */
export type RuleDisplay = "idle" | "ok" | "bad";

/** 每条要求现在是否满足。`current` 传 `undefined` 表示这一页没有「当前密码」框,第 3 条不出现。 */
export function passwordRulesMet(next: string, current?: string, minLength = PASSWORD_MIN_LENGTH): Partial<Record<PasswordRule, boolean>> {
  const met: Partial<Record<PasswordRule, boolean>> = {
    min_length: next.length >= minLength,
    // Django 的 NumericPasswordValidator 是 `password.isdigit()`:空串不算全数字,但空串也谈不上「做到了」。
    not_digits: next.length > 0 && !/^\d+$/.test(next),
  };
  // 当前密码还没填时无从比较:保持未达标,不抢先打勾。
  if (current !== undefined) met.not_current = next.length > 0 && current.length > 0 && next !== current;
  return met;
}

/** 「两次输入一致」:确认框空着不算一致。 */
export const passwordsMatch = (next: string, confirm: string): boolean => confirm.length > 0 && next === confirm;

/**
 * 一条要求画成什么。用户还在输的时候不标红:没达标只是 ○;`judged`(离开过这个框,或点过保存)之后才是 !。
 * 已经标了 ! 的,改到达标立刻变 ✓。
 */
export const ruleDisplay = (met: boolean, judged: boolean): RuleDisplay => (met ? "ok" : judged ? "bad" : "idle");

/** 清单里没达标的那几条,按显示顺序;点保存时用它决定发不发请求、读屏念哪几条。 */
export function unmetRules(next: string, current?: string, minLength = PASSWORD_MIN_LENGTH): PasswordRule[] {
  const met = passwordRulesMet(next, current, minLength);
  return (["min_length", "not_digits", "not_current"] as const).filter((rule) => rule in met && !met[rule]);
}
