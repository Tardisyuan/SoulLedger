import { platform } from "../platform/index";

/**
 * 「以此人身份查看」(Design 第二十八批 W6)的客户端状态。机制与服务端规则见
 * `backend/apps/authentication/impersonation.py`。
 *
 * 代看令牌换进 session 存储里的 access 位置(于是 `api` 的请求拦截器照常带上它),管理员自己的 access
 * 令牌连同这次代看的说明一起收在另一个 session 键里:**刷新、换页都还在**(同一个标签页),
 * 关掉标签页就没了 —— 与 access 令牌同一寿命。刷新令牌(cookie)全程没动,所以「退出查看」
 * 只是把管理员的 access 放回去;放回去的那张若已过期,下一次 401 走正常的刷新。
 *
 * 代看期间 `client.ts` 的 401 不走刷新(见那里):刷新会把管理员的新令牌写进 access 位置,悄悄结束代看。
 */
export const IMPERSONATION_KEY = "soulledger_impersonation";
/** 与后端 `impersonation.MAX_MINUTES` 一致。 */
export const IMPERSONATION_MAX_MINUTES = 30;

export interface ImpersonationState {
  id: number;
  target: { id: number; name: string; role: string; hall: Record<string, string> | null };
  reason: string;
  /** 到点的时刻(毫秒,按本机时钟:已按服务器与本机的时差校正)。 */
  expiresAt: number;
  /** 管理员自己的 access 令牌,退出时放回。 */
  adminAccess: string | null;
}

const listeners = new Set<() => void>();
let cache: { raw: string | null; value: ImpersonationState | null } = { raw: null, value: null };

export function notifyImpersonation(): void {
  for (const handler of [...listeners]) handler();
}

/** 当前的代看状态;没有在看 → `null`。同一个存储值返回同一个对象(可放进 useSyncExternalStore)。 */
export function getImpersonation(): ImpersonationState | null {
  // Storage can throw (private window, blocked site data): that reads as "not viewing as anyone", never as a
  // crash of the layout that asks on every render.
  let raw: string | null = null;
  try {
    raw = platform().session.get(IMPERSONATION_KEY);
  } catch {
    raw = null;
  }
  if (raw === cache.raw) return cache.value;
  let value: ImpersonationState | null = null;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && typeof (parsed as ImpersonationState).id === "number") {
      value = parsed as ImpersonationState;
    }
  } catch {
    value = null;
  }
  cache = { raw, value };
  return value;
}

export function subscribeImpersonation(handler: () => void): () => void {
  listeners.add(handler);
  return () => {
    listeners.delete(handler);
  };
}

