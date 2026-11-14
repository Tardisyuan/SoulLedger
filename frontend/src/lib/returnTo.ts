/**
 * 登录后回原页(便利性审查 2026-11-15 W1)。会话过期时被送回 /login 的那一页记在 sessionStorage,
 * 登录(或两步验证)成功后读一次、立即删掉,去那里;没有或不合格就走 `defaultViewRoute`。
 *
 * 写入的四处:`proxy.ts` 的 `?redirect=`(登录页加载时读进来)、`onUnauthorized` 跳走之前
 * (`lib/platform/web.ts`)。主动退出清掉(`TenantContext.logout`),下一个人不会落到上一个人的页面。
 *
 * sessionStorage 而不是只用 URL 参数:verify 那一步还要再传一次,容易漏;关掉标签页它就没了。
 */
export const RETURN_TO_KEY = "soulledger_return_to";

/**
 * 同源相对路径才认,防开放重定向。必须以单个 `/` 开头;`//x`、`/\x` 浏览器会当成另一个主机;
 * 任何地方出现 `://` 都不要;控制字符与空白不要(浏览器会删掉制表符和换行,`/\t/evil` 就成了 `//evil`);
 * 登录页本身和 /goodbye 回去没有意义。
 */
export function safeReturnTo(path: string | null | undefined): string | null {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  if (path[1] === "/" || path[1] === "\\") return null;
  if (path.includes("://")) return null;
  for (let i = 0; i < path.length; i++) {
    const c = path.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f) return null;
  }
  const pathname = path.split(/[?#]/)[0];
  if (pathname.startsWith("/login")) return null;
  if (pathname === "/goodbye" || pathname.startsWith("/goodbye/")) return null;
  return path;
}

/** 记下一页;不合格的不记(已有的也不动)。 */
export function rememberReturnTo(path: string | null | undefined): void {
  const safe = safeReturnTo(path);
  if (!safe) return;
  try {
    sessionStorage.setItem(RETURN_TO_KEY, safe);
  } catch {
    // Storage disabled: sign-in lands on the default view, as before.
  }
}

/** 读一次就删;读出来的再校验一遍(sessionStorage 别的脚本也写得进)。 */
export function takeReturnTo(): string | null {
  try {
    const stored = sessionStorage.getItem(RETURN_TO_KEY);
    sessionStorage.removeItem(RETURN_TO_KEY);
    return safeReturnTo(stored);
  } catch {
    return null;
  }
}

export function clearReturnTo(): void {
  try {
    sessionStorage.removeItem(RETURN_TO_KEY);
  } catch {
    // nothing to clear
  }
}
