/**
 * 「从哪儿来」的显式来源(v3:返回键直接回到来源队列,不依赖浏览器历史猜测)。
 * 打开详情的那一处在链接上写 `?from=<站内路径>`;面包屑前的返回键与页内的返回链接读它。
 */
export const FROM_PARAM = "from";

/** 只收站内路径:一个 `/` 开头,不是 `//`(协议相对,会跳到别的站),不含 `\`。其余一律当没有。 */
export function sourceFrom(raw: string | null | undefined): string | null {
  return raw && raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : null;
}

/** `href` 带上来源。`from` 不是站内路径时原样返回 `href`。 */
export function withFrom(href: string, from: string | null | undefined): string {
  const safe = sourceFrom(from);
  if (!safe) return href;
  return `${href}${href.includes("?") ? "&" : "?"}${FROM_PARAM}=${encodeURIComponent(safe)}`;
}
