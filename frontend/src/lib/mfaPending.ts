/**
 * 登录第二步的交接(A12):`/login` 收到 `mfa_required` 后把待验证令牌放进 `sessionStorage`,
 * `/login/verify` 读走。sessionStorage 而不是 URL:令牌不该进历史记录与 Referer;而不是 localStorage:
 * 它只活 5 分钟,关掉标签页就该没了。没有条目时第二步页面直接退回 /login。
 */
export const MFA_PENDING_KEY = "soulledger_mfa_pending";

export interface MfaPending {
  pending_token: string;
  username: string;
}

export function storeMfaPending(p: MfaPending): void {
  try {
    sessionStorage.setItem(MFA_PENDING_KEY, JSON.stringify(p));
  } catch {
    // Storage disabled: the verify page will send the operator back to /login.
  }
}

export function readMfaPending(): MfaPending | null {
  try {
    const raw = sessionStorage.getItem(MFA_PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MfaPending>;
    return typeof parsed.pending_token === "string" && typeof parsed.username === "string"
      ? { pending_token: parsed.pending_token, username: parsed.username }
      : null;
  } catch {
    return null;
  }
}

export function clearMfaPending(): void {
  try {
    sessionStorage.removeItem(MFA_PENDING_KEY);
  } catch {
    // nothing to clear
  }
}
