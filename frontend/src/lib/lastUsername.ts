/**
 * 记住的账号(便利性审查 2026-11-15 W3;Design 第五十二批 F4)。只在第一步勾了「在此设备上保持登录」时,于登录(含两步验证)
 * 成功之后写;没勾就删掉 —— 这一次的选择说了算。登录页拿它画「记住的账号」卡片(与两个 App 同一张)、焦点落在密码框;
 * 只有「换一个账号」清掉它 —— 退出登录以后卡片仍在,只要再输密码(第五十二批 F4)。只有账号名与显示名,没有任何令牌。
 *
 * 存的是 `{"username","display_name"}`;W3 那一版只存了账号名的纯字符串,读到时迁成新形(显示名空,卡片只画脱敏账号)。
 */
export const LAST_USERNAME_KEY = "soulledger_last_username";

export interface LastAccount {
  username: string;
  display_name: string;
}

function write(account: LastAccount): void {
  localStorage.setItem(LAST_USERNAME_KEY, JSON.stringify(account));
}

export function readLastAccount(): LastAccount | null {
  try {
    const raw = localStorage.getItem(LAST_USERNAME_KEY);
    if (!raw || !raw.trim()) return null;
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // W3's plain string.
    }
    if (parsed && typeof parsed === "object") {
      const { username, display_name } = parsed as Partial<LastAccount>;
      if (typeof username !== "string" || !username.trim()) return null;
      return { username, display_name: typeof display_name === "string" ? display_name : "" };
    }
    // A plain name (W3), or a JSON scalar that happens to parse (a username of digits): migrate it.
    const account = { username: raw, display_name: "" };
    write(account);
    return account;
  } catch {
    return null;
  }
}

/** 登录成功后调:勾了「保持登录」就记下账号名与显示名,没勾就忘掉。 */
export function settleLastUsername(username: string | null | undefined, remember: boolean, displayName?: string | null): void {
  try {
    if (remember && username && username.trim()) write({ username, display_name: displayName ?? "" });
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
