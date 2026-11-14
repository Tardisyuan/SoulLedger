/**
 * 多标签页同步(便利性审查 2026-11-15 W4)。一个标签页登录或主动退出后,告诉同一浏览器里的其他标签页:
 * 退出 → 它们也清掉自己的会话、去 /login;登录 → 它们刷新一次,读到新的会话。
 *
 * 只传 `signed-out` / `signed-in` 两个词,**不传令牌、不传用户**:频道是同源的,但消息不需要带任何东西,
 * 也就不会漏出任何东西。BroadcastChannel 不会把消息发回发送者自己,所以不会来回弹。
 * 没有 BroadcastChannel 的环境(jsdom、很旧的浏览器)什么都不做:各标签页照旧各管各的。
 */
export const SESSION_CHANNEL = "soulledger_session";

export type SessionMessage = "signed-out" | "signed-in";

function open(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(SESSION_CHANNEL);
  } catch {
    return null;
  }
}

export function announceSession(message: SessionMessage): void {
  const channel = open();
  if (!channel) return;
  try {
    channel.postMessage(message);
  } finally {
    channel.close();
  }
}

/** 听别的标签页;认不出的消息丢掉。返回退订。 */
export function onSessionMessage(handler: (message: SessionMessage) => void): () => void {
  const channel = open();
  if (!channel) return () => {};
  channel.onmessage = (e: MessageEvent) => {
    if (e.data === "signed-out" || e.data === "signed-in") handler(e.data);
  };
  return () => channel.close();
}
