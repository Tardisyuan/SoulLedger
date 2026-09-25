/**
 * 「插入审判台」要去的那件案子:这个用户**最后打开的一件未结案**,只记在这台浏览器里。
 *
 * 按用户分键:同一台机器上换人登录,不会把上一个人的案子当成自己的。审判台打开一件
 * 未结案就记下它,打开的是已结案、且正是记着的那件,就忘掉 —— 它已经不能再引用了。
 * localStorage 在隐私模式或站点数据被禁时会抛异常,所以每一次读写都兜住:记不住只是
 * 退回「选一件」,不是坏掉的页面。
 */
export interface RememberedCase {
  id: string;
  soul_name: string;
}

const key = (userId: string | number) => `soulledger_last_open_case:${userId}`;

export function lastOpenCase(userId: string | number): RememberedCase | null {
  try {
    const raw = localStorage.getItem(key(userId));
    const value = raw ? (JSON.parse(raw) as Partial<RememberedCase>) : null;
    return value && typeof value.id === "string" ? { id: value.id, soul_name: String(value.soul_name ?? "") } : null;
  } catch {
    return null;
  }
}

export function rememberOpenCase(userId: string | number, c: RememberedCase): void {
  try {
    localStorage.setItem(key(userId), JSON.stringify(c));
  } catch {
    /* not remembered — the corpus falls back to the picker */
  }
}

export function forgetOpenCase(userId: string | number, id: string): void {
  try {
    if (lastOpenCase(userId)?.id === id) localStorage.removeItem(key(userId));
  } catch {
    /* nothing to forget */
  }
}
