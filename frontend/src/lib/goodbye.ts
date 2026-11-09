/**
 * 退出登录时留给「再会」页(app/goodbye)的一张便条:名字与文明皮。退出会清掉用户,所以在清之前写;
 * 再会页读一次就删 —— 刷新、或之后直接打开 /goodbye,都是中性的。只放 sessionStorage,不进 cookie。
 */
const KEY = "soulledger_goodbye";
const SKINS = new Set(["cn", "eu", "eg", "gr"]);

export interface GoodbyeNote {
  name: string | null;
  civ: "cn" | "eu" | "eg" | "gr" | null;
}

export function leaveGoodbye(note: { name?: string | null; civ?: string | null }): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ name: note.name || null, civ: note.civ ?? null }));
  } catch {
    /* 隐私模式等写不进去:再会页照样是中性的。 */
  }
}

export function readGoodbye(): GoodbyeNote | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Record<string, unknown>;
    const name = typeof v.name === "string" && v.name.trim() ? v.name.trim().slice(0, 60) : null;
    const civ = typeof v.civ === "string" && SKINS.has(v.civ) ? (v.civ as GoodbyeNote["civ"]) : null;
    return { name, civ };
  } catch {
    return null;
  }
}
