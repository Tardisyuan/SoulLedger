/**
 * 记住账号名(便利性审查 2026-11-15 W3)。只在第一步勾了「在此设备上保持登录」时,于登录(含两步验证)
 * 成功之后写;没勾就删掉 —— 这一次的选择说了算。登录页拿它预填账号、焦点落在密码框;
 * 「换个账号」和主动退出都清掉。只有账号名,没有任何令牌。
 */
export const LAST_USERNAME_KEY = "soulledger_last_username";

export function readLastUsername(): string | null {
  try {
    const v = localStorage.getItem(LAST_USERNAME_KEY);
    return v && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/** 登录成功后调:勾了「保持登录」就记下,没勾就忘掉。 */
export function settleLastUsername(username: string | null | undefined, remember: boolean): void {
  try {
    if (remember && username && username.trim()) localStorage.setItem(LAST_USERNAME_KEY, username);
    else localStorage.removeItem(LAST_USERNAME_KEY);
  } catch {
    // Storage disabled: the form simply starts empty next time.
  }
}

export function forgetLastUsername(): void {
  try {
    localStorage.removeItem(LAST_USERNAME_KEY);
  } catch {
    // nothing to forget
  }
}
