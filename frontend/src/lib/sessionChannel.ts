/**
 * 多标签页同步(便利性审查 2026-11-15 W4)。一个标签页登录或主动退出后,告诉同一浏览器里的其他标签页:
 * 退出 → 它们也清掉自己的会话、去 /login;登录 → 它们刷新一次,读到新的会话。
 *
 * 只传 `signed-out` / `signed-in` 两个词,**不传令牌、不传用户**:频道是同源的,但消息不需要带任何东西,
 * 也就不会漏出任何东西。BroadcastChannel 只是不把消息发回**发送它的那个对象** —— 同一页里另开一个同名频道照样收得到
 * (E2E 2026-11-15:登录页发 signed-in,本页的监听收到后删掉了刚拿到的令牌)。所以一页只开一个频道对象，收发共用。
 * 没有 BroadcastChannel 的环境(jsdom、很旧的浏览器)什么都不做:各标签页照旧各管各的。
 */
export const SESSION_CHANNEL = "soulledger_session";

export type SessionMessage = "signed-out" | "signed-in";

let shared: BroadcastChannel | null | undefined;

/** The one channel object of this page: what it sends never comes back to it, so the page never hears itself. */
function channel(): BroadcastChannel | null {
  if (shared !== undefined) return shared;
  if (typeof BroadcastChannel === "undefined") return (shared = null);
  try {
    shared = new BroadcastChannel(SESSION_CHANNEL);
  } catch {
    shared = null;
  }
  return shared;
}

export function announceSession(message: SessionMessage): void {
  channel()?.postMessage(message);
}

/** 听别的标签页;认不出的消息丢掉。返回退订。 */
export function onSessionMessage(handler: (message: SessionMessage) => void): () => void {
  const ch = channel();
  if (!ch) return () => {};
  const listener = (e: MessageEvent) => {
    if (e.data === "signed-out" || e.data === "signed-in") handler(e.data);
  };
  ch.addEventListener("message", listener);
  return () => ch.removeEventListener("message", listener);
}

/** Tests only: forget the page's channel (jsdom keeps module state between tests). */
export function resetSessionChannelForTests(): void {
  shared?.close();
  shared = undefined;
}
